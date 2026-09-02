import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { open, type Database } from "sqlite";
import sqlite3 from "sqlite3";
import { isLikelyJobEmail } from "./emailPrefilter";
import { redactSensitiveText } from "./privacyRedactor";
import { decideEmailAutomationOutcome } from "./decisionEngine";
import { findBestJobMatches, getConfidentSingleMatch } from "./jobMatcher";
import { getCodexOAuthConfig, isCodexOAuthConfigured } from "./codexClient";
import { normalizeNimBaseUrl, CHAT_COMPLETIONS_PATH } from "./nimClassifier";
import {
  abortEmailAutomationScan,
  createCodexConnectUrl,
  ensureEmailAutomationTables,
  getAutomationStatus,
  handleCodexOAuthCallback,
  isAutomationPollingEnabled,
  listAutomationQueue,
  runEmailAutomationScan,
  setAutomationPollingEnabled,
  testClassifierConnection,
} from "./emailAutomationService";
import type {
  JobApplication,
  EmailAutomationDecision,
  GmailMessageEvidence,
} from "@jobapp/shared";

let db: Database<sqlite3.Database, sqlite3.Statement> | undefined;

async function createDb() {
  db = await open({ filename: ":memory:", driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      stage TEXT NOT NULL,
      date TEXT NOT NULL,
      salary TEXT NOT NULL,
      location TEXT NOT NULL,
      workMode TEXT NOT NULL,
      url TEXT NOT NULL,
      notes TEXT NOT NULL,
      reminderDate TEXT,
      checklist TEXT NOT NULL,
      contacts TEXT NOT NULL,
      history TEXT NOT NULL
    );
  `);
  await ensureEmailAutomationTables(db);
  await db.run(
    `INSERT INTO gmail_auth (id, accessToken, refreshToken, expiresAt, updatedAt)
     VALUES ('default', 'test-token', 'refresh-token', ?, ?)`,
    [Date.now() + 60 * 60_000, new Date().toISOString()],
  );
  return db;
}

async function insertApplication(application: JobApplication) {
  await db!.run(
    `INSERT INTO applications (
      id, company, role, stage, date, salary, location, workMode, url, notes, checklist, contacts, history
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      application.id,
      application.company,
      application.role,
      application.stage,
      application.date,
      application.salary,
      application.location,
      application.workMode,
      application.url,
      application.notes,
      JSON.stringify(application.checklist),
      JSON.stringify(application.contacts || []),
      JSON.stringify(application.history || []),
    ],
  );
}

const baseApplication: JobApplication = {
  id: "APP-1",
  company: "Acme",
  role: "Frontend Engineer",
  stage: "Applied",
  date: "2026-06-01",
  salary: "TBD",
  location: "Bangkok",
  workMode: "Hybrid",
  url: "https://careers.acme.com/frontend",
  notes: "",
  checklist: [],
  contacts: [],
  history: [],
};

afterEach(async () => {
  rs.unstubAllGlobals();
  await db?.close();
  db = undefined;
});

describe("email automation pure rules", () => {
  it("redacts sensitive fields before NIM input", () => {
    const redacted = redactSensitiveText(
      "Contact me at jane@example.com or +66 81 234 5678. Job URL https://example.com/private?token=abc",
    );

    expect(redacted).not.toContain("jane@example.com");
    expect(redacted).not.toContain("+66 81 234 5678");
    expect(redacted).not.toContain("https://example.com");
    expect(redacted).toContain("[email]");
    expect(redacted).toContain("[phone]");
    expect(redacted).toContain("[url]");
  });

  it("prefilters Thai application emails", () => {
    expect(
      isLikelyJobEmail({
        subject: "ยืนยันการยื่นสมัครงาน",
        sender: "jobs@example.com",
        snippet: "ขอบคุณที่สมัครตำแหน่ง Frontend Engineer",
      }),
    ).toBe(true);
  });

  it("finds a confident company and role match", () => {
    const matches = findBestJobMatches([baseApplication], {
      company: "Acme",
      role: "Frontend Engineer",
      senderDomain: "acme.com",
      subject: "Application update",
    });

    expect(getConfidentSingleMatch(matches)?.application.id).toBe("APP-1");
  });

  it("auto-rejects only when confidence and matching are strong", () => {
    const decision: EmailAutomationDecision = {
      category: "rejection",
      confidence: 0.91,
      company: "Acme",
      role: "Frontend Engineer",
      recommendedAction: "mark_rejected",
      reason: "The email says the candidate was not selected.",
    };
    const evidence: GmailMessageEvidence = {
      messageId: "msg-1",
      threadId: "thread-1",
      subject: "Application update",
      sender: "Recruiting <jobs@acme.com>",
      senderDomain: "acme.com",
      receivedAt: "2026-06-02T00:00:00.000Z",
      snippet: "Unfortunately...",
    };

    const outcome = decideEmailAutomationOutcome(decision, evidence, [
      baseApplication,
    ]);
    expect(outcome.action).toBe("mark_rejected");
    expect(outcome.autoApply).toBe(true);

    const lowConfidenceOutcome = decideEmailAutomationOutcome(
      { ...decision, confidence: 0.7 },
      evidence,
      [baseApplication],
    );
    expect(lowConfidenceOutcome.action).toBe("mark_rejected");
    expect(lowConfidenceOutcome.autoApply).toBe(false);
  });
});

describe("Codex OAuth configuration", () => {
  it("defaults the redirect URI to the daemon port and honors explicit overrides", () => {
    expect(getCodexOAuthConfig({}).redirectUri).toBe(
      "http://localhost:1455/auth/callback",
    );
    expect(getCodexOAuthConfig({ PORT: "1457" }).redirectUri).toBe(
      "http://localhost:1457/auth/callback",
    );
    expect(
      getCodexOAuthConfig({
        OPENAI_CODEX_REDIRECT_URI: "http://localhost:9999/callback",
      }).redirectUri,
    ).toBe("http://localhost:9999/callback");
  });

  it("does not report Codex OAuth configured from fallback defaults alone", () => {
    expect(isCodexOAuthConfigured({})).toBe(false);
    expect(
      isCodexOAuthConfigured({
        OPENAI_CODEX_CLIENT_ID: "client-id",
        OPENAI_CODEX_REDIRECT_URI: "http://localhost:1455/auth/callback",
      }),
    ).toBe(true);
  });

  it("stores Codex PKCE verifiers per OAuth state so concurrent attempts do not overwrite each other", async () => {
    const testDb = await createDb();
    const responses = [
      new Response(
        JSON.stringify({
          access_token: "token-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({ account_id: "account-1", plan_type: "plus" }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          access_token: "token-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({ account_id: "account-2", plan_type: "plus" }),
        { status: 200 },
      ),
    ];
    const fetchMock = rs.fn(
      async (_url: string | URL, _init?: RequestInit) => responses.shift()!,
    );
    rs.stubEnv("OPENAI_CODEX_CLIENT_ID", "client-id");
    rs.stubEnv(
      "OPENAI_CODEX_REDIRECT_URI",
      "http://localhost:3001/api/codex/oauth/callback",
    );
    rs.stubGlobal("fetch", fetchMock);

    const firstUrl = new URL(await createCodexConnectUrl(testDb));
    const secondUrl = new URL(await createCodexConnectUrl(testDb));
    const firstState = firstUrl.searchParams.get("state")!;
    const secondState = secondUrl.searchParams.get("state")!;

    expect(firstState).toBeTruthy();
    expect(secondState).toBeTruthy();
    expect(firstState).not.toBe(secondState);

    await handleCodexOAuthCallback(testDb, "code-1", firstState);
    await expect(
      handleCodexOAuthCallback(testDb, "code-reuse", firstState),
    ).rejects.toThrow("Invalid Codex OAuth state");
    await handleCodexOAuthCallback(testDb, "code-2", secondState);

    const tokenRequests = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/oauth/token"),
    );
    expect(tokenRequests).toHaveLength(2);
    const firstBody = tokenRequests[0]?.[1]?.body as URLSearchParams;
    const secondBody = tokenRequests[1]?.[1]?.body as URLSearchParams;
    expect(firstBody.get("code_verifier")).toBeTruthy();
    expect(secondBody.get("code_verifier")).toBeTruthy();
    expect(firstBody.get("code_verifier")).not.toBe(
      secondBody.get("code_verifier"),
    );
  });
});

describe("classifier connection tests", () => {
  it("uses selected NIM model for a minimal connection probe", async () => {
    const testDb = await createDb();
    rs.stubEnv("NVIDIA_NIM_API_KEY", "nim-key");
    rs.stubGlobal(
      "fetch",
      rs.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })),
    );

    const result = await testClassifierConnection(testDb, {
      provider: "nim",
      model: "openai/gpt-5.5",
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("nim");
    expect(result.model).toBe("openai/gpt-5.5");
    const fetchMock = fetch as any;
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("openai/gpt-5.5");
    expect(body.messages[0].content).toContain("Reply with ok");
  });

  it("reports missing NIM API key as a connection error", async () => {
    const testDb = await createDb();
    rs.stubEnv("NVIDIA_NIM_API_KEY", "");
    rs.stubEnv("NIM_API_KEY", "");

    await expect(
      testClassifierConnection(testDb, {
        provider: "nim",
        model: "meta/llama-3.1-8b-instruct",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("reports missing Codex auth as a connection error", async () => {
    const testDb = await createDb();

    await expect(
      testClassifierConnection(testDb, { provider: "codex", model: "gpt-5.5" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("email automation scan flow", () => {
  it("stores polling enabled/disabled separately from manual scan", async () => {
    const testDb = await createDb();

    expect(await isAutomationPollingEnabled(testDb)).toBe(true);
    expect((await getAutomationStatus(testDb)).schedulerEnabled).toBe(true);

    await setAutomationPollingEnabled(testDb, false);
    expect(await isAutomationPollingEnabled(testDb)).toBe(false);
    expect((await getAutomationStatus(testDb)).schedulerEnabled).toBe(false);

    await runEmailAutomationScan(testDb, {
      listMessages: async () => [],
    });

    expect((await getAutomationStatus(testDb)).lastScanStatus).toBe(
      "completed",
    );
  });

  it("creates high-confidence applications from fake Gmail and NIM clients", async () => {
    const testDb = await createDb();
    await runEmailAutomationScan(testDb, {
      listMessages: async () => [
        { id: "msg-create", threadId: "thread-create" },
      ],
      getMessage: async () => ({
        messageId: "msg-create",
        threadId: "thread-create",
        subject: "ยืนยันการยื่นสมัครงาน Frontend Engineer",
        sender: "Careers <jobs@acme.com>",
        receivedAt: "2026-06-02T00:00:00.000Z",
        snippet: "ขอบคุณที่สมัครตำแหน่ง Frontend Engineer",
        bodyText: "ขอบคุณที่สมัครตำแหน่ง Frontend Engineer ที่ Acme",
      }),
      classify: async () => ({
        category: "application_submitted",
        confidence: 0.94,
        company: "Acme",
        role: "Frontend Engineer",
        recommendedAction: "create_application",
        reason: "Application confirmation.",
      }),
    });

    const rows = await testDb.all("SELECT * FROM applications");
    expect(rows).toHaveLength(1);
    expect(rows[0].company).toBe("Acme");
  });

  it("queues low-confidence status decisions instead of auto-applying them", async () => {
    const testDb = await createDb();
    await insertApplication(baseApplication);

    await runEmailAutomationScan(testDb, {
      listMessages: async () => [
        { id: "msg-reject", threadId: "thread-reject" },
      ],
      getMessage: async () => ({
        messageId: "msg-reject",
        threadId: "thread-reject",
        subject: "Application update for Frontend Engineer",
        sender: "Careers <jobs@acme.com>",
        receivedAt: "2026-06-02T00:00:00.000Z",
        snippet: "Unfortunately, we will not move forward.",
        bodyText:
          "Unfortunately, we will not move forward with your application at Acme.",
      }),
      classify: async () => ({
        category: "rejection",
        confidence: 0.72,
        company: "Acme",
        role: "Frontend Engineer",
        recommendedAction: "mark_rejected",
        reason: "Possible rejection.",
      }),
    });

    const queue = await listAutomationQueue(testDb);
    const rows = await testDb.all("SELECT * FROM applications");

    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe("pending");
    expect(queue[0].action).toBe("mark_rejected");
    expect(rows[0].stage).toBe("Applied");
  });

  it("extracts company and role and successfully matches to existing application for closed_or_expired", async () => {
    const testDb = await createDb();
    // Insert a matching application
    await insertApplication({
      ...baseApplication,
      company: "THAI SECOM SECURITY CO., LTD.",
      role: "Junior Full Stack Developer",
    });

    await runEmailAutomationScan(testDb, {
      listMessages: async () => [
        { id: "msg-closed", threadId: "thread-closed" },
      ],
      getMessage: async () => ({
        messageId: "msg-closed",
        threadId: "thread-closed",
        subject: "สวัสดี Jaruvit ตำแหน่งงาน Junior Full Stack Developer / Programmer/โปรแกรมเมอร์ ของ THAI SECOM SECURITY CO., LTD. ได้ปิดรับสมัครแล้ว",
        sender: "noreply@e.jobsdb.com",
        receivedAt: "2026-06-25T04:30:42.000Z",
        snippet: "สวัสดี คุณ Jaruvit ตำแหน่งงาน Junior Full Stack Developer / Programmer/โปรแกรมเมอร์ ซึ่งคุณได้สมัครไว้ที่ THAI SECOM SECURITY CO., LTD. หมดอายุแล้ว",
        bodyText: "สวัสดี คุณ Jaruvit ตำแหน่งงาน Junior Full Stack Developer / Programmer/โปรแกรมเมอร์ ซึ่งคุณได้สมัครไว้ที่ THAI SECOM SECURITY CO., LTD. หมดอายุแล้ว และบริษัทปิดรับใบสมัครแล้ว",
      }),
      classify: async () => ({
        category: "closed_or_expired",
        confidence: 0.95,
        company: "THAI SECOM SECURITY CO., LTD.",
        role: "Junior Full Stack Developer",
        recommendedAction: "queue_review",
        reason: "Explicitly states the job position has expired.",
      }),
    });

    const states = await testDb.all("SELECT * FROM email_processing_state");
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("applied");
    expect(states[0].category).toBe("closed_or_expired");

    const rows = await testDb.all("SELECT * FROM applications");
    expect(rows[0].stage).toBe("Rejected");

    const decisions = await testDb.all("SELECT * FROM email_decisions");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].company).toBe("THAI SECOM SECURITY CO., LTD.");
    expect(decisions[0].role).toBe("Junior Full Stack Developer");
  });

  it("aborts the scan mid-execution when abortEmailAutomationScan is called", async () => {
    const testDb = await createDb();

    let processedCount = 0;
    await expect(
      runEmailAutomationScan(testDb, {
        listMessages: async () => [
          { id: "msg-1", threadId: "thread-1" },
          { id: "msg-2", threadId: "thread-2" },
        ],
        getMessage: async (token, id) => {
          if (id === "msg-2") {
            processedCount++;
          }
          return {
            messageId: id,
            threadId: id === "msg-1" ? "thread-1" : "thread-2",
            subject: "Job position info",
            sender: "jobs@acme.com",
            receivedAt: "2026-06-02T00:00:00.000Z",
            snippet: "Snippet text",
            bodyText: "Body text",
          };
        },
        classify: async () => {
          abortEmailAutomationScan();
          const err = new Error("Scan aborted by user");
          err.name = "AbortError";
          throw err;
        },
      })
    ).rejects.toThrow("Scan aborted by user");

    expect(processedCount).toBe(0);

    const states = await testDb.all("SELECT * FROM email_processing_state");
    expect(states).toHaveLength(0);

    const status = await getAutomationStatus(testDb);
    expect(status.lastScanStatus).toBe("failed");
    expect(status.lastScanError).toBe("Scan aborted by user");
  });

  it("resets stuck running scan status to failed during database initialization", async () => {
    const testDb = await createDb();

    await testDb.run(
      `INSERT INTO automation_settings (key, value, updatedAt)
       VALUES (?, ?, ?)`,
      ["last_scan_status", "running", new Date().toISOString()]
    );

    await ensureEmailAutomationTables(testDb);

    const status = await getAutomationStatus(testDb);
    expect(status.lastScanStatus).toBe("failed");
    expect(status.lastScanError).toBe("Scan interrupted by server restart");
  });
});

describe("NIM Base URL Normalization", () => {
  it("handles empty and undefined inputs by returning default URL", () => {
    expect(normalizeNimBaseUrl(undefined)).toBe("https://integrate.api.nvidia.com/v1");
    expect(normalizeNimBaseUrl("")).toBe("https://integrate.api.nvidia.com/v1");
    expect(normalizeNimBaseUrl("   ")).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("handles base URL with no trailing slash", () => {
    expect(normalizeNimBaseUrl("https://integrate.api.nvidia.com/v1")).toBe(
      "https://integrate.api.nvidia.com/v1"
    );
  });

  it("handles base URL with trailing slash", () => {
    expect(normalizeNimBaseUrl("https://integrate.api.nvidia.com/v1/")).toBe(
      "https://integrate.api.nvidia.com/v1"
    );
  });

  it("handles base URL with endpoint included", () => {
    expect(
      normalizeNimBaseUrl("https://integrate.api.nvidia.com/v1/chat/completions")
    ).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("handles base URL with endpoint and trailing slash included", () => {
    expect(
      normalizeNimBaseUrl("https://integrate.api.nvidia.com/v1/chat/completions/")
    ).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("handles unexpected double slash", () => {
    expect(
      normalizeNimBaseUrl("https://integrate.api.nvidia.com/v1//chat/completions")
    ).toBe("https://integrate.api.nvidia.com/v1");
    expect(
      normalizeNimBaseUrl("https://integrate.api.nvidia.com/v1//chat/completions//")
    ).toBe("https://integrate.api.nvidia.com/v1");
    expect(normalizeNimBaseUrl("https://integrate.api.nvidia.com/v1//")).toBe(
      "https://integrate.api.nvidia.com/v1"
    );
  });

  it("ensures generated endpoints never contain /chat/completions/chat/completions", () => {
    const urls = [
      "https://integrate.api.nvidia.com/v1",
      "https://integrate.api.nvidia.com/v1/",
      "https://integrate.api.nvidia.com/v1/chat/completions",
      "https://integrate.api.nvidia.com/v1/chat/completions/",
      "https://integrate.api.nvidia.com/v1//chat/completions",
    ];

    for (const url of urls) {
      const normalized = normalizeNimBaseUrl(url);
      const endpoint = `${normalized}${CHAT_COMPLETIONS_PATH}`;
      expect(endpoint).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
      expect(endpoint).not.toContain("/chat/completions/chat/completions");
    }
  });
});

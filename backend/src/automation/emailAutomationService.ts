import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Database } from "sqlite";
import type sqlite3 from "sqlite3";
import {
  emailAutomationDecisionJsonSchema,
  isEmailAutomationDecision,
  type JobApplication,
  type ActivityLogEntry,
  type ClassifierConnectionTestResponse,
  type ClassifierProvider,
  type CodexConnectionStatus,
  type EmailAutomationDecision,
  type EmailAutomationQueueItem,
  type GmailAutomationStatus,
  type GmailMessageEvidence,
} from "@jobapp/shared";
import {
  buildRedactedEmailContent,
  extractSenderDomain,
} from "./privacyRedactor";
import { isLikelyJobEmail } from "./emailPrefilter";
import { decideEmailAutomationOutcome } from "./decisionEngine";
import {
  classifyJobEmailWithNim,
  isNimConfigured,
  getNimConfigFromEnv,
  testNimConnection,
  logNimConfig,
} from "./nimClassifier";
import {
  buildGmailAuthUrl,
  exchangeGmailAuthCode,
  getGmailMessageContent,
  isGmailOAuthConfigured,
  listRecentGmailMessages,
  refreshGmailAccessToken,
  type GmailMessageContent,
  type GmailTokenSet,
} from "./gmailClient";
import {
  buildCodexAuthUrl,
  createCodexPkcePair,
  exchangeCodexAuthCode,
  fetchCodexAccountInfo,
  isCodexOAuthConfigured,
  postCodexResponseStream,
  refreshCodexAccessToken,
  type CodexResponseInput,
  type CodexTokenSet,
} from "./codexClient";

type SqliteDb = Database<sqlite3.Database, sqlite3.Statement>;

interface AutomationDependencies {
  classify?: (
    email: ReturnType<typeof buildRedactedEmailContent>,
  ) => Promise<EmailAutomationDecision>;
  listMessages?: (
    accessToken: string,
  ) => Promise<Array<{ id: string; threadId: string }>>;
  getMessage?: (
    accessToken: string,
    messageId: string,
  ) => Promise<GmailMessageContent>;
}

interface StoredTokenRow {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: number;
  scope?: string | null;
  tokenType?: string | null;
}

interface StoredCodexTokenRow extends StoredTokenRow {
  chatgptAccountId?: string | null;
  chatgptPlanType?: string | null;
  lastRefreshAt?: string | null;
  lastError?: string | null;
}

const POLL_INTERVAL_MS = Number(
  process.env.GMAIL_POLL_INTERVAL_MS || 10 * 60 * 1000,
);
const POLLING_ENABLED_SETTING = "polling_enabled";
const CODEX_OAUTH_ATTEMPTS_SETTING = "codex_oauth_attempts";
const CODEX_OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const CLASSIFIER_TEST_TIMEOUT_MS = 20_000;

function nowIso(): string {
  return new Date().toISOString();
}

function jwtExpiresAt(jwt: string): number | undefined {
  const [, payload] = jwt.split(".");
  if (!payload) return undefined;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function parseApplicationRow(row: any): JobApplication {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    stage: row.stage,
    date: row.date,
    salary: row.salary,
    location: row.location,
    workMode: row.workMode,
    url: row.url,
    notes: row.notes,
    reminderDate: row.reminderDate || undefined,
    checklist: JSON.parse(row.checklist),
    contacts: JSON.parse(row.contacts),
    history: JSON.parse(row.history),
  };
}

async function getApplications(db: SqliteDb): Promise<JobApplication[]> {
  const rows = await db.all("SELECT * FROM applications");
  return rows.map(parseApplicationRow);
}

async function insertApplication(
  db: SqliteDb,
  appData: JobApplication,
): Promise<void> {
  await db.run(
    `INSERT INTO applications (
      id, company, role, stage, date, salary, location, workMode, url, notes, reminderDate, checklist, contacts, history
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      appData.id,
      appData.company,
      appData.role,
      appData.stage,
      appData.date,
      appData.salary,
      appData.location,
      appData.workMode,
      appData.url,
      appData.notes,
      appData.reminderDate || null,
      JSON.stringify(appData.checklist || []),
      JSON.stringify(appData.contacts || []),
      JSON.stringify(appData.history || []),
    ],
  );
}

async function updateApplication(
  db: SqliteDb,
  appData: JobApplication,
): Promise<void> {
  await db.run(
    `UPDATE applications SET
      company = ?,
      role = ?,
      stage = ?,
      date = ?,
      salary = ?,
      location = ?,
      workMode = ?,
      url = ?,
      notes = ?,
      reminderDate = ?,
      checklist = ?,
      contacts = ?,
      history = ?
    WHERE id = ?`,
    [
      appData.company,
      appData.role,
      appData.stage,
      appData.date,
      appData.salary,
      appData.location,
      appData.workMode,
      appData.url,
      appData.notes,
      appData.reminderDate || null,
      JSON.stringify(appData.checklist || []),
      JSON.stringify(appData.contacts || []),
      JSON.stringify(appData.history || []),
      appData.id,
    ],
  );
}

export async function setSetting(
  db: SqliteDb,
  key: string,
  value: string,
): Promise<void> {
  await db.run(
    `INSERT INTO automation_settings (key, value, updatedAt)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    [key, value, nowIso()],
  );
}

export async function getSetting(
  db: SqliteDb,
  key: string,
): Promise<string | undefined> {
  const row = await db.get(
    "SELECT value FROM automation_settings WHERE key = ?",
    [key],
  );
  return row?.value;
}

interface CodexOAuthAttempt {
  verifier: string;
  createdAt: number;
}

function pruneCodexOAuthAttempts(
  attempts: Record<string, CodexOAuthAttempt>,
  now = Date.now(),
): Record<string, CodexOAuthAttempt> {
  return Object.fromEntries(
    Object.entries(attempts).filter(
      ([, attempt]) => now - attempt.createdAt <= CODEX_OAUTH_ATTEMPT_TTL_MS,
    ),
  );
}

async function getCodexOAuthAttempts(
  db: SqliteDb,
): Promise<Record<string, CodexOAuthAttempt>> {
  const raw = await getSetting(db, CODEX_OAUTH_ATTEMPTS_SETTING);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, CodexOAuthAttempt>;
    return pruneCodexOAuthAttempts(parsed);
  } catch {
    return {};
  }
}

async function saveCodexOAuthAttempts(
  db: SqliteDb,
  attempts: Record<string, CodexOAuthAttempt>,
): Promise<void> {
  await setSetting(
    db,
    CODEX_OAUTH_ATTEMPTS_SETTING,
    JSON.stringify(pruneCodexOAuthAttempts(attempts)),
  );
}

export async function isAutomationPollingEnabled(
  db: SqliteDb,
): Promise<boolean> {
  const value = await getSetting(db, POLLING_ENABLED_SETTING);
  return value !== "false";
}

export async function setAutomationPollingEnabled(
  db: SqliteDb,
  enabled: boolean,
): Promise<void> {
  await setSetting(db, POLLING_ENABLED_SETTING, enabled ? "true" : "false");
}

async function getStoredToken(db: SqliteDb): Promise<GmailTokenSet | null> {
  const row = await db.get<StoredTokenRow>(
    "SELECT * FROM gmail_auth WHERE id = ?",
    ["default"],
  );
  if (!row) return null;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken || undefined,
    expiresAt: row.expiresAt,
    scope: row.scope || undefined,
    tokenType: row.tokenType || undefined,
  };
}

async function saveStoredToken(
  db: SqliteDb,
  token: GmailTokenSet,
): Promise<void> {
  await db.run(
    `INSERT INTO gmail_auth (id, accessToken, refreshToken, expiresAt, scope, tokenType, updatedAt)
     VALUES ('default', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       accessToken = excluded.accessToken,
       refreshToken = COALESCE(excluded.refreshToken, gmail_auth.refreshToken),
       expiresAt = excluded.expiresAt,
       scope = excluded.scope,
       tokenType = excluded.tokenType,
       updatedAt = excluded.updatedAt`,
    [
      token.accessToken,
      token.refreshToken || null,
      token.expiresAt,
      token.scope || null,
      token.tokenType || null,
      nowIso(),
    ],
  );
}

async function getValidAccessToken(db: SqliteDb): Promise<string | null> {
  const token = await getStoredToken(db);
  if (!token) return null;
  if (token.expiresAt > Date.now() + 60_000) return token.accessToken;
  if (!token.refreshToken) return null;

  const refreshed = await refreshGmailAccessToken(token.refreshToken);
  await saveStoredToken(db, refreshed);
  return refreshed.accessToken;
}

async function getStoredCodexToken(
  db: SqliteDb,
): Promise<CodexTokenSet | null> {
  const row = await db.get<StoredCodexTokenRow>(
    "SELECT * FROM codex_auth WHERE id = ?",
    ["default"],
  );
  if (!row) return null;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken || undefined,
    expiresAt: row.expiresAt,
    scope: row.scope || undefined,
    tokenType: row.tokenType || undefined,
    chatgptAccountId: row.chatgptAccountId || undefined,
    chatgptPlanType: row.chatgptPlanType || undefined,
  };
}

async function saveStoredCodexToken(
  db: SqliteDb,
  token: CodexTokenSet,
  options: { lastRefreshAt?: string; lastError?: string } = {},
): Promise<void> {
  await db.run(
    `INSERT INTO codex_auth (
      id, accessToken, refreshToken, expiresAt, scope, tokenType, chatgptAccountId, chatgptPlanType, lastRefreshAt, lastError, updatedAt
    ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      accessToken = excluded.accessToken,
      refreshToken = COALESCE(excluded.refreshToken, codex_auth.refreshToken),
      expiresAt = excluded.expiresAt,
      scope = excluded.scope,
      tokenType = excluded.tokenType,
      chatgptAccountId = COALESCE(excluded.chatgptAccountId, codex_auth.chatgptAccountId),
      chatgptPlanType = COALESCE(excluded.chatgptPlanType, codex_auth.chatgptPlanType),
      lastRefreshAt = COALESCE(excluded.lastRefreshAt, codex_auth.lastRefreshAt),
      lastError = excluded.lastError,
      updatedAt = excluded.updatedAt`,
    [
      token.accessToken,
      token.refreshToken || null,
      token.expiresAt,
      token.scope || null,
      token.tokenType || null,
      token.chatgptAccountId || null,
      token.chatgptPlanType || null,
      options.lastRefreshAt || null,
      options.lastError || null,
      nowIso(),
    ],
  );
}

async function setCodexLastError(
  db: SqliteDb,
  lastError: string,
): Promise<void> {
  await db.run(
    "UPDATE codex_auth SET lastError = ?, updatedAt = ? WHERE id = ?",
    [lastError, nowIso(), "default"],
  );
}

async function getValidCodexToken(db: SqliteDb): Promise<CodexTokenSet | null> {
  const token = await getStoredCodexToken(db);
  if (!token) return null;
  if (token.expiresAt > Date.now() + 60_000) return token;
  if (!token.refreshToken) return null;

  try {
    const refreshed = await refreshCodexAccessToken(token.refreshToken);
    const merged = {
      ...refreshed,
      chatgptAccountId: refreshed.chatgptAccountId || token.chatgptAccountId,
      chatgptPlanType: refreshed.chatgptPlanType || token.chatgptPlanType,
    };
    await saveStoredCodexToken(db, merged, {
      lastRefreshAt: nowIso(),
      lastError: "",
    });
    return merged;
  } catch (error: any) {
    await setCodexLastError(db, error.message);
    throw error;
  }
}

export async function ensureEmailAutomationTables(db: SqliteDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS gmail_auth (
      id TEXT PRIMARY KEY,
      accessToken TEXT NOT NULL,
      refreshToken TEXT,
      expiresAt INTEGER NOT NULL,
      scope TEXT,
      tokenType TEXT,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codex_auth (
      id TEXT PRIMARY KEY,
      accessToken TEXT NOT NULL,
      refreshToken TEXT,
      expiresAt INTEGER NOT NULL,
      scope TEXT,
      tokenType TEXT,
      chatgptAccountId TEXT,
      chatgptPlanType TEXT,
      lastRefreshAt TEXT,
      lastError TEXT,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_processing_state (
      messageId TEXT PRIMARY KEY,
      threadId TEXT NOT NULL,
      processedAt TEXT NOT NULL,
      status TEXT NOT NULL,
      category TEXT,
      decisionId TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS email_decisions (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      confidence REAL NOT NULL,
      action TEXT NOT NULL,
      company TEXT,
      role TEXT,
      decisionJson TEXT NOT NULL,
      evidenceJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_queue (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      action TEXT NOT NULL,
      decisionJson TEXT NOT NULL,
      evidenceJson TEXT NOT NULL,
      proposedApplicationJson TEXT,
      matchedApplicationId TEXT,
      failureReason TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  try {
    const lastStatus = await db.get(
      "SELECT value FROM automation_settings WHERE key = ?",
      ["last_scan_status"],
    );
    if (lastStatus?.value === "running") {
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO automation_settings (key, value, updatedAt)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
        ["last_scan_status", "failed", now],
      );
      await db.run(
        `INSERT INTO automation_settings (key, value, updatedAt)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
        ["last_scan_error", "Scan interrupted by server restart", now],
      );
    }
  } catch (err) {
    console.error("Failed to reset stuck scan status:", err);
  }
}

export async function createGmailConnectUrl(db: SqliteDb): Promise<string> {
  const state = crypto.randomBytes(16).toString("hex");
  await setSetting(db, "gmail_oauth_state", state);
  return buildGmailAuthUrl(state);
}

export async function handleGmailOAuthCallback(
  db: SqliteDb,
  code: string,
  state: string,
): Promise<void> {
  const expectedState = await getSetting(db, "gmail_oauth_state");
  if (!expectedState || expectedState !== state) {
    throw new Error("Invalid Gmail OAuth state");
  }
  const token = await exchangeGmailAuthCode(code);
  await saveStoredToken(db, token);
  await setSetting(db, "gmail_oauth_state", "");
}

export async function createCodexConnectUrl(db: SqliteDb): Promise<string> {
  if (!isCodexOAuthConfigured()) {
    throw new Error(
      "Codex OAuth is missing OPENAI_CODEX_CLIENT_ID and OPENAI_CODEX_REDIRECT_URI",
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const pkce = createCodexPkcePair();
  const attempts = await getCodexOAuthAttempts(db);
  attempts[state] = { verifier: pkce.verifier, createdAt: Date.now() };
  await saveCodexOAuthAttempts(db, attempts);
  return buildCodexAuthUrl(state, pkce.challenge);
}

export async function handleCodexOAuthCallback(
  db: SqliteDb,
  code: string,
  state: string,
): Promise<void> {
  const attempts = await getCodexOAuthAttempts(db);
  const attempt = attempts[state];
  if (!attempt) {
    await saveCodexOAuthAttempts(db, attempts);
    throw new Error("Invalid Codex OAuth state");
  }

  delete attempts[state];
  await saveCodexOAuthAttempts(db, attempts);

  const token = await exchangeCodexAuthCode(code, attempt.verifier);
  const accountInfo = await fetchCodexAccountInfo(token.accessToken);
  await saveStoredCodexToken(
    db,
    { ...token, ...accountInfo },
    { lastError: "" },
  );
}

export async function importCodexCliAuth(db: SqliteDb): Promise<void> {
  const authPath =
    process.env.CODEX_AUTH_JSON_PATH ||
    path.join(os.homedir(), ".codex", "auth.json");
  let raw: string;
  try {
    raw = await fs.readFile(authPath, "utf8");
  } catch {
    throw new Error(
      `Codex CLI auth cache not found at ${authPath}. Run 'codex login' first.`,
    );
  }

  const parsed = JSON.parse(raw) as {
    tokens?: {
      access_token?: string;
      refresh_token?: string;
      account_id?: string;
    };
  };

  const accessToken = parsed.tokens?.access_token;
  const refreshToken = parsed.tokens?.refresh_token;
  if (!accessToken || !refreshToken) {
    throw new Error(
      "Codex CLI auth cache does not contain ChatGPT access and refresh tokens.",
    );
  }

  const accountInfo = await fetchCodexAccountInfo(accessToken);
  await saveStoredCodexToken(
    db,
    {
      accessToken,
      refreshToken,
      expiresAt: jwtExpiresAt(accessToken) || Date.now() + 3600 * 1000,
      chatgptAccountId:
        accountInfo.chatgptAccountId || parsed.tokens?.account_id,
      chatgptPlanType: accountInfo.chatgptPlanType,
    },
    { lastRefreshAt: nowIso(), lastError: "" },
  );
}

export async function getCodexStatus(
  db: SqliteDb,
): Promise<CodexConnectionStatus> {
  const row = await db.get<StoredCodexTokenRow>(
    "SELECT * FROM codex_auth WHERE id = ?",
    ["default"],
  );
  const accessTokenUsable = Boolean(
    row?.accessToken && row.expiresAt > Date.now() + 60_000,
  );

  return {
    codexConnected: Boolean(row?.refreshToken || accessTokenUsable),
    codexConfigured: isCodexOAuthConfigured(),
    chatgptAccountId: row?.chatgptAccountId || undefined,
    chatgptPlanType: row?.chatgptPlanType || undefined,
    expiresAt: row?.expiresAt,
    hasRefreshToken: Boolean(row?.refreshToken),
    lastRefreshAt: row?.lastRefreshAt || undefined,
    lastError: row?.lastError || undefined,
  };
}

export class ClassifierConnectionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "ClassifierConnectionError";
  }
}

export async function streamCodexResponse(
  db: SqliteDb,
  input: CodexResponseInput,
  signal?: AbortSignal,
): Promise<Response> {
  const token = await getValidCodexToken(db);
  if (!token) {
    throw new Error(
      "ChatGPT Plus / Codex is not connected or token refresh is unavailable",
    );
  }

  let upstream = await postCodexResponseStream(
    token.accessToken,
    token.chatgptAccountId,
    input,
    signal,
  );
  if (upstream.status !== 401) {
    if (!upstream.ok) {
      throw new Error(
        `OpenAI Responses API request failed (${upstream.status}): ${(await upstream.text()).slice(0, 500)}`,
      );
    }
    return upstream;
  }

  if (!token.refreshToken) {
    throw new Error(
      "OpenAI Responses API returned 401 and no Codex refresh token is stored",
    );
  }

  const refreshed = await refreshCodexAccessToken(token.refreshToken);
  const merged = {
    ...refreshed,
    chatgptAccountId: refreshed.chatgptAccountId || token.chatgptAccountId,
    chatgptPlanType: refreshed.chatgptPlanType || token.chatgptPlanType,
  };
  await saveStoredCodexToken(db, merged, {
    lastRefreshAt: nowIso(),
    lastError: "",
  });
  upstream = await postCodexResponseStream(
    merged.accessToken,
    merged.chatgptAccountId,
    input,
    signal,
  );
  if (!upstream.ok) {
    throw new Error(
      `OpenAI Responses API request failed after refresh (${upstream.status}): ${(await upstream.text()).slice(0, 500)}`,
    );
  }
  return upstream;
}

async function markMessageProcessed(
  db: SqliteDb,
  input: {
    messageId: string;
    threadId: string;
    status: string;
    category?: string;
    decisionId?: string;
    error?: string;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO email_processing_state (messageId, threadId, processedAt, status, category, decisionId, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(messageId) DO UPDATE SET
       processedAt = excluded.processedAt,
       status = excluded.status,
       category = excluded.category,
       decisionId = excluded.decisionId,
       error = excluded.error`,
    [
      input.messageId,
      input.threadId,
      nowIso(),
      input.status,
      input.category || null,
      input.decisionId || null,
      input.error || null,
    ],
  );
}

async function saveDecision(
  db: SqliteDb,
  decision: EmailAutomationDecision,
  evidence: GmailMessageEvidence,
): Promise<string> {
  const id = `DEC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  await db.run(
    `INSERT INTO email_decisions (
      id, messageId, category, confidence, action, company, role, decisionJson, evidenceJson, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(messageId) DO UPDATE SET
      id = excluded.id,
      category = excluded.category,
      confidence = excluded.confidence,
      action = excluded.action,
      company = excluded.company,
      role = excluded.role,
      decisionJson = excluded.decisionJson,
      evidenceJson = excluded.evidenceJson,
      createdAt = excluded.createdAt`,
    [
      id,
      evidence.messageId,
      decision.category,
      decision.confidence,
      decision.recommendedAction,
      decision.company || null,
      decision.role || null,
      JSON.stringify(decision),
      JSON.stringify(evidence),
      nowIso(),
    ],
  );
  return id;
}

async function enqueueDecision(
  db: SqliteDb,
  input: {
    action: EmailAutomationQueueItem["action"];
    decision: EmailAutomationDecision;
    evidence: GmailMessageEvidence;
    proposedApplication?: JobApplication;
    matchedApplicationId?: string;
    reason: string;
  },
): Promise<void> {
  const id = `QUEUE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  await db.run(
    `INSERT INTO automation_queue (
      id, messageId, status, action, decisionJson, evidenceJson, proposedApplicationJson,
      matchedApplicationId, failureReason, createdAt, updatedAt
    ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(messageId) DO UPDATE SET
      id = excluded.id,
      status = 'pending',
      action = excluded.action,
      decisionJson = excluded.decisionJson,
      evidenceJson = excluded.evidenceJson,
      proposedApplicationJson = excluded.proposedApplicationJson,
      matchedApplicationId = excluded.matchedApplicationId,
      failureReason = excluded.failureReason,
      createdAt = excluded.createdAt,
      updatedAt = excluded.updatedAt`,
    [
      id,
      input.evidence.messageId,
      input.action,
      JSON.stringify(input.decision),
      JSON.stringify(input.evidence),
      input.proposedApplication
        ? JSON.stringify(input.proposedApplication)
        : null,
      input.matchedApplicationId || null,
      input.reason,
      nowIso(),
      nowIso(),
    ],
  );
}

async function markRejectedFromEmail(
  db: SqliteDb,
  application: JobApplication,
  evidence: GmailMessageEvidence,
  decision: EmailAutomationDecision,
): Promise<void> {
  const timestamp = nowIso();
  const historyEntry: ActivityLogEntry = {
    id: `log-${Date.now()}-automation-rejected-${Math.floor(Math.random() * 10000)}`,
    timestamp,
    type: "stage_change",
    message: `Stage moved from ${application.stage} to Rejected by Gmail automation`,
  };
  await updateApplication(db, {
    ...application,
    stage: "Rejected",
    notes: [
      application.notes,
      `Gmail automation marked this as Rejected.`,
      `Subject: ${evidence.subject}`,
      `Reason: ${decision.reason}`,
      `Gmail message: ${evidence.messageId}`,
    ]
      .filter(Boolean)
      .join("\n"),
    history: [historyEntry, ...(application.history || [])],
  });
}

async function processMessage(
  db: SqliteDb,
  accessToken: string,
  messageId: string,
  deps: AutomationDependencies,
  signal?: AbortSignal,
): Promise<void> {
  const alreadyProcessed = await db.get(
    "SELECT messageId FROM email_processing_state WHERE messageId = ?",
    [messageId],
  );
  if (alreadyProcessed) return;

  let message: any;
  try {
    message = await (
      deps.getMessage || ((token, id) => getGmailMessageContent(token, id, signal))
    )(accessToken, messageId);

    const evidence: GmailMessageEvidence = {
      messageId: message.messageId,
      threadId: message.threadId,
      subject: message.subject,
      sender: message.sender,
      senderDomain: extractSenderDomain(message.sender),
      receivedAt: message.receivedAt,
      snippet: message.snippet,
    };

    if (!isLikelyJobEmail(message)) {
      await markMessageProcessed(db, {
        messageId: evidence.messageId,
        threadId: evidence.threadId,
        status: "ignored",
        category: "not_job_related",
      });
      return;
    }

    const redacted = buildRedactedEmailContent(message);
    const decision = await (
      deps.classify || ((email) => classifyJobEmail(db, email, signal))
    )(redacted);
    const decisionId = await saveDecision(db, decision, evidence);
    const applications = await getApplications(db);
    const outcome = decideEmailAutomationOutcome(
      decision,
      evidence,
      applications,
    );

    if (
      outcome.autoApply &&
      outcome.action === "create_application" &&
      outcome.proposedApplication
    ) {
      await insertApplication(db, outcome.proposedApplication);
      await markMessageProcessed(db, {
        messageId: evidence.messageId,
        threadId: evidence.threadId,
        status: "applied",
        category: decision.category,
        decisionId,
      });
      return;
    }

    if (
      outcome.autoApply &&
      outcome.action === "mark_rejected" &&
      outcome.matchedApplication
    ) {
      await markRejectedFromEmail(
        db,
        outcome.matchedApplication,
        evidence,
        decision,
      );
      await markMessageProcessed(db, {
        messageId: evidence.messageId,
        threadId: evidence.threadId,
        status: "applied",
        category: decision.category,
        decisionId,
      });
      return;
    }

    if (outcome.action === "ignore") {
      await markMessageProcessed(db, {
        messageId: evidence.messageId,
        threadId: evidence.threadId,
        status: "ignored",
        category: decision.category,
        decisionId,
      });
      return;
    }

    await enqueueDecision(db, {
      action: outcome.action,
      decision,
      evidence,
      proposedApplication: outcome.proposedApplication,
      matchedApplicationId: outcome.matchedApplication?.id,
      reason: outcome.reason,
    });
    await markMessageProcessed(db, {
      messageId: evidence.messageId,
      threadId: evidence.threadId,
      status: "queued",
      category: decision.category,
      decisionId,
    });
  } catch (error: any) {
    if (error.name === "AbortError" || error.message === "Scan aborted by user") {
      throw error;
    }
    await markMessageProcessed(db, {
      messageId: messageId,
      threadId: message?.threadId || messageId,
      status: "failed",
      error: error.message,
    });
    throw error;
  }
}

let currentScanAbortController: AbortController | null = null;

export function abortEmailAutomationScan(): void {
  if (currentScanAbortController) {
    currentScanAbortController.abort();
  }
}

export async function runEmailAutomationScan(
  db: SqliteDb,
  deps: AutomationDependencies = {},
): Promise<{ processed: number }> {
  const accessToken = await getValidAccessToken(db);
  if (!accessToken) {
    throw new Error("Gmail is not connected or token refresh is unavailable");
  }

  await setSetting(db, "last_scan_at", nowIso());
  await setSetting(db, "last_scan_status", "running");

  currentScanAbortController = new AbortController();
  const signal = currentScanAbortController.signal;

  const messages = await (
    deps.listMessages || ((token) => listRecentGmailMessages(token, 100, signal))
  )(accessToken);
  let processed = 0;
  await setSetting(db, "scan_progress_processed", "0");
  await setSetting(db, "scan_progress_total", String(messages.length));

  try {
    for (const message of messages) {
      if (signal.aborted) {
        throw new Error("Scan aborted by user");
      }
      await processMessage(db, accessToken, message.id, deps, signal);
      processed += 1;
      await setSetting(db, "scan_progress_processed", String(processed));
    }
    await setSetting(db, "last_scan_status", "completed");
    await setSetting(db, "last_scan_error", "");
    return { processed };
  } catch (error: any) {
    await setSetting(db, "last_scan_status", "failed");
    await setSetting(db, "last_scan_error", error.message);
    throw error;
  } finally {
    if (currentScanAbortController?.signal === signal) {
      currentScanAbortController = null;
    }
  }
}

function parseQueueRow(row: any): EmailAutomationQueueItem {
  return {
    id: row.id,
    messageId: row.messageId,
    status: row.status,
    action: row.action,
    decision: JSON.parse(row.decisionJson),
    evidence: JSON.parse(row.evidenceJson),
    proposedApplication: row.proposedApplicationJson
      ? JSON.parse(row.proposedApplicationJson)
      : undefined,
    matchedApplicationId: row.matchedApplicationId || undefined,
    failureReason: row.failureReason || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listAutomationQueue(
  db: SqliteDb,
): Promise<EmailAutomationQueueItem[]> {
  const rows = await db.all(
    "SELECT * FROM automation_queue ORDER BY createdAt DESC",
  );
  return rows.map(parseQueueRow);
}

async function getQueueItem(
  db: SqliteDb,
  id: string,
): Promise<EmailAutomationQueueItem | null> {
  const row = await db.get("SELECT * FROM automation_queue WHERE id = ?", [id]);
  return row ? parseQueueRow(row) : null;
}

async function updateQueueStatus(
  db: SqliteDb,
  id: string,
  status: EmailAutomationQueueItem["status"],
  failureReason?: string,
  matchedApplicationId?: string,
): Promise<void> {
  await db.run(
    `UPDATE automation_queue SET status = ?, failureReason = ?, matchedApplicationId = COALESCE(?, matchedApplicationId), updatedAt = ? WHERE id = ?`,
    [status, failureReason || null, matchedApplicationId || null, nowIso(), id],
  );
}

export async function applyAutomationQueueItem(
  db: SqliteDb,
  id: string,
): Promise<void> {
  const item = await getQueueItem(db, id);
  if (!item || item.status !== "pending") {
    throw new Error("Queue item not found or already resolved");
  }

  if (item.action === "create_application" && item.proposedApplication) {
    await insertApplication(db, item.proposedApplication as JobApplication);
    await updateQueueStatus(db, id, "applied");
    return;
  }

  if (item.action === "mark_rejected" && item.matchedApplicationId) {
    const row = await db.get("SELECT * FROM applications WHERE id = ?", [
      item.matchedApplicationId,
    ]);
    if (!row) throw new Error("Matched application was not found");
    await markRejectedFromEmail(
      db,
      parseApplicationRow(row),
      item.evidence,
      item.decision,
    );
    await updateQueueStatus(db, id, "applied");
    return;
  }

  throw new Error(
    "Queue item needs a linked application before it can be applied",
  );
}

export async function ignoreAutomationQueueItem(
  db: SqliteDb,
  id: string,
): Promise<void> {
  const item = await getQueueItem(db, id);
  if (!item || item.status !== "pending") {
    throw new Error("Queue item not found or already resolved");
  }
  await updateQueueStatus(db, id, "ignored");
}

export async function linkAutomationQueueItem(
  db: SqliteDb,
  id: string,
  applicationId: string,
): Promise<void> {
  const item = await getQueueItem(db, id);
  if (!item || item.status !== "pending") {
    throw new Error("Queue item not found or already resolved");
  }

  const row = await db.get("SELECT * FROM applications WHERE id = ?", [
    applicationId,
  ]);
  if (!row) throw new Error("Linked application was not found");

  const application = parseApplicationRow(row);
  if (
    item.decision.category === "rejection" ||
    item.decision.category === "closed_or_expired"
  ) {
    await markRejectedFromEmail(db, application, item.evidence, item.decision);
  } else {
    const historyEntry: ActivityLogEntry = {
      id: `log-${Date.now()}-automation-link-${Math.floor(Math.random() * 10000)}`,
      timestamp: nowIso(),
      type: "note_update",
      message: `Linked Gmail automation message ${item.evidence.messageId}`,
    };
    await updateApplication(db, {
      ...application,
      notes: [
        application.notes,
        `Linked Gmail automation message.`,
        `Subject: ${item.evidence.subject}`,
        `Reason: ${item.decision.reason}`,
      ]
        .filter(Boolean)
        .join("\n"),
      history: [historyEntry, ...(application.history || [])],
    });
  }

  await updateQueueStatus(db, id, "applied", undefined, applicationId);
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Response did not contain a JSON object");
    return JSON.parse(match[0]);
  }
}

export async function classifyJobEmailWithCodex(
  db: SqliteDb,
  email: ReturnType<typeof buildRedactedEmailContent>,
  model?: string,
  signal?: AbortSignal,
): Promise<EmailAutomationDecision> {
  const instructions = `Classify job-application emails. Return only JSON matching the schema:
${JSON.stringify(emailAutomationDecisionJsonSchema, null, 2)}
You MUST identify and extract the company name into the "company" field, and the job title/position into the "role" field. If the company name or job title/role cannot be determined, set them to "Unknown" or "".
Use application_submitted for submitted/applied confirmations, rejection for rejected/not selected, closed_or_expired for closed/expired job posts, interview_or_next_step for interviews/assessments, not_job_related for unrelated mail, and uncertain when evidence is weak. Prefer queue_review unless action is clear.
Ensure the output is a single valid JSON object. Do not include markdown code block styling or backticks.`;

  const input: CodexResponseInput = {
    model: model || undefined,
    input: [{ role: "user", content: JSON.stringify(email) }],
    instructions,
  };

  const upstream = await streamCodexResponse(db, input, signal);
  if (!upstream.body) {
    throw new Error("Codex response stream is empty");
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let leftover = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = (leftover + chunk).split("\n");
    leftover = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const dataStr = line.slice(6).trim();
        if (dataStr && dataStr !== "[DONE]") {
          try {
            const event = JSON.parse(dataStr);
            if (event.type === "response.output_text.delta" && event.delta) {
              fullText += event.delta;
            }
          } catch {
            // Ignore parse errors for partial or malformed lines
          }
        }
      }
    }
  }

  if (leftover.startsWith("data: ")) {
    const dataStr = leftover.slice(6).trim();
    if (dataStr && dataStr !== "[DONE]") {
      try {
        const event = JSON.parse(dataStr);
        if (event.type === "response.output_text.delta" && event.delta) {
          fullText += event.delta;
        }
      } catch {}
    }
  }

  const parsed = parseJsonObject(fullText);
  if (!isEmailAutomationDecision(parsed)) {
    throw new Error("Codex response failed email automation schema validation");
  }
  return parsed;
}

export async function testClassifierConnection(
  db: SqliteDb,
  input: { provider: ClassifierProvider; model: string; nimApiKey?: string; nimEndpointPath?: string },
): Promise<ClassifierConnectionTestResponse> {
  const model = input.model.trim();
  if (!model) {
    throw new ClassifierConnectionError("Model name cannot be empty.", 400);
  }

  const startedAt = Date.now();
  const signal = AbortSignal.timeout(CLASSIFIER_TEST_TIMEOUT_MS);
  try {
    if (input.provider === "codex") {
      const upstream = await streamCodexResponse(
        db,
        {
          model,
          instructions: 'Reply with exactly "ok".',
          input: [{ role: "user", content: "Connection test. Reply with ok." }],
        },
        signal,
      );
      await upstream.body?.cancel();
    } else {
      // Configuration precedence resolution: Request input > Database setting > Environment variable > Default
      const envConfig = getNimConfigFromEnv();
      let apiKey = envConfig.apiKey;
      let apiKeySource: "Database" | "Environment" | "Request" | "Default" = "Default";

      if (envConfig.apiKey) {
        apiKeySource = "Environment";
      }

      const dbApiKey = await getSetting(db, "nim_api_key");
      if (dbApiKey) {
        apiKey = dbApiKey;
        apiKeySource = "Database";
      }

      if (input.nimApiKey) {
        apiKey = input.nimApiKey;
        apiKeySource = "Request";
      }

      let endpointPath = envConfig.endpointPath;
      let _endpointPathSource: "Database" | "Environment" | "Request" | "Default" = "Default";

      if (envConfig.endpointPath) {
        _endpointPathSource = "Environment";
      }

      const dbEndpointPath = await getSetting(db, "nim_endpoint_path");
      if (dbEndpointPath) {
        endpointPath = dbEndpointPath;
        _endpointPathSource = "Database";
      }

      if (input.nimEndpointPath) {
        endpointPath = input.nimEndpointPath;
        _endpointPathSource = "Request";
      }

      const config = {
        apiKey,
        model,
        baseUrl: envConfig.baseUrl,
        endpointPath,
      };

      logNimConfig(config, apiKeySource);
      await testNimConnection(config, signal);
    }
  } catch (error: any) {
    const message = error?.message || "Classifier connection test failed";
    const statusCode =
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? 504
        : message.includes("not connected") || message.includes("Missing ")
          ? 409
          : 502;
    throw new ClassifierConnectionError(message, statusCode);
  }

  const providerLabel = input.provider === "codex" ? "ChatGPT Plus" : "NVIDIA NIM";
  return {
    ok: true,
    provider: input.provider,
    model,
    message: `${providerLabel} ${model} connection OK.`,
    latencyMs: Date.now() - startedAt,
  };
}

export async function classifyJobEmail(
  db: SqliteDb,
  email: ReturnType<typeof buildRedactedEmailContent>,
  signal?: AbortSignal,
): Promise<EmailAutomationDecision> {
  const provider = (await getSetting(db, "classifier_provider")) || "nim";
  const model = await getSetting(db, "classifier_model");

  if (provider === "codex") {
    return classifyJobEmailWithCodex(db, email, model, signal);
  } else {
    // Configuration precedence resolution: Database setting > Environment variable > Default
    const envConfig = getNimConfigFromEnv();
    let apiKey = envConfig.apiKey;
    let apiKeySource: "Database" | "Environment" | "Default" = "Default";

    if (envConfig.apiKey) {
      apiKeySource = "Environment";
    }

    const nimApiKey = await getSetting(db, "nim_api_key");
    if (nimApiKey) {
      apiKey = nimApiKey;
      apiKeySource = "Database";
    }

    const dbEndpointPath = await getSetting(db, "nim_endpoint_path");

    const config = {
      apiKey,
      model: model || envConfig.model,
      baseUrl: envConfig.baseUrl,
      endpointPath: dbEndpointPath || envConfig.endpointPath,
    };

    logNimConfig(config, apiKeySource);
    return classifyJobEmailWithNim(email, config, signal);
  }
}

export async function getAutomationStatus(
  db: SqliteDb,
): Promise<GmailAutomationStatus> {
  const token = await getStoredToken(db);
  const pending = await db.get(
    "SELECT COUNT(*) as count FROM automation_queue WHERE status = ?",
    ["pending"],
  );
  const processed = await db.get(
    "SELECT COUNT(*) as count FROM email_processing_state",
  );
  const lastScanAt = await getSetting(db, "last_scan_at");
  const lastScanStatus = await getSetting(db, "last_scan_status");
  const lastScanError = await getSetting(db, "last_scan_error");
  const scanProgressProcessed = await getSetting(db, "scan_progress_processed");
  const scanProgressTotal = await getSetting(db, "scan_progress_total");
  const pollingEnabled = await isAutomationPollingEnabled(db);
  const classifierProvider =
    (await getSetting(db, "classifier_provider")) || "nim";
  const classifierModel = await getSetting(db, "classifier_model");
  const nimApiKey = await getSetting(db, "nim_api_key");

  const accessTokenUsable = Boolean(
    token?.accessToken && token.expiresAt > Date.now() + 60_000,
  );

  return {
    gmailConnected: Boolean(token?.refreshToken || accessTokenUsable),
    gmailConfigured: isGmailOAuthConfigured(),
    hasRefreshToken: Boolean(token?.refreshToken),
    expiresAt: token?.expiresAt,
    nimConfigured: isNimConfigured() || Boolean(nimApiKey),
    nimApiKey: nimApiKey || "",
    schedulerEnabled: pollingEnabled,
    pollIntervalMs: POLL_INTERVAL_MS,
    lastScanAt,
    lastScanStatus:
      lastScanStatus === "completed" || lastScanStatus === "failed" || lastScanStatus === "running"
        ? lastScanStatus
        : undefined,
    lastScanError: lastScanError || undefined,
    pendingQueueCount: Number(pending?.count || 0),
    processedMessageCount: Number(processed?.count || 0),
    classifierProvider: classifierProvider as "nim" | "codex",
    classifierModel: classifierModel || undefined,
    scanProgressProcessed: scanProgressProcessed !== undefined ? Number(scanProgressProcessed) : undefined,
    scanProgressTotal: scanProgressTotal !== undefined ? Number(scanProgressTotal) : undefined,
  };
}

export function canStartGmailAutomation(): boolean {
  return (
    isGmailOAuthConfigured() && (isNimConfigured() || isCodexOAuthConfigured())
  );
}

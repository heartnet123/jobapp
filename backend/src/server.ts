import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import path from "path";
import fs from "node:fs";
import { fileURLToPath } from "url";

// Load .env file manually into process.env if it exists.
// Existing process env always wins so test/dev scripts can override PORT safely.
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const parsedEnv: Record<string, string> = {};
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index > 0) {
        const key = trimmed.slice(0, index).trim();
        let val = trimmed.slice(index + 1).trim();
        // Strip quotes if any
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        parsedEnv[key] = val;
      }
    }

    for (const [key, val] of Object.entries(parsedEnv)) {
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
} catch (err) {
  console.warn("Failed to load .env file:", err);
}
import type { JobApplication } from "@jobapp/shared";
import { STAGES, WORK_MODES } from "@jobapp/shared";
import { extractTextFromPdf, parseResumeText } from "./resumeParser";
import {
  abortEmailAutomationScan,
  applyAutomationQueueItem,
  canStartGmailAutomation,
  ClassifierConnectionError,
  createCodexConnectUrl,
  createGmailConnectUrl,
  ensureEmailAutomationTables,
  getAutomationStatus,
  getCodexStatus,
  handleCodexOAuthCallback,
  handleGmailOAuthCallback,
  ignoreAutomationQueueItem,
  importCodexCliAuth,
  isAutomationPollingEnabled,
  linkAutomationQueueItem,
  listAutomationQueue,
  runEmailAutomationScan,
  setAutomationPollingEnabled,
  setSetting,
  streamCodexResponse,
  testClassifierConnection,
} from "./automation/emailAutomationService";
import { validateNimEnvConfig } from "./automation/nimClassifier";

// ES Module dirname resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port and DB settings
const PORT = process.env.PORT || 3001;
function getDbPath(): string {
  return path.resolve(
    __dirname,
    process.env.NODE_ENV === "test"
      ? `../../jobs.test.${process.pid}.db`
      : process.env.JOBS_DB_PATH || "../../jobs.db",
  );
}

let DB_PATH = getDbPath();

const app = express();
app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));

// Pure backend API server only - do not serve frontend assets
app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path === "/auth/callback") {
    return next();
  }
  res.status(404).json({ error: "Not Found" });
});


let db: Database<sqlite3.Database, sqlite3.Statement>;
let automationInterval: NodeJS.Timeout | undefined;
const APPLICATION_REQUIRED_FIELDS = ["id", "company", "role", "stage"] as const;
const VALID_STAGES = new Set<string>(STAGES);
const VALID_WORK_MODES = new Set<string>(WORK_MODES);
const APPLICATION_STRING_LIMITS = {
  id: 128,
  company: 200,
  role: 200,
  date: 128,
  salary: 128,
  location: 256,
  url: 2048,
  notes: 10000,
  reminderDate: 128,
} as const;
const CHECKLIST_ITEM_TEXT_MAX_LENGTH = 1000;

function oauthSuccessHtml(provider: string) {
  const safeProvider = provider.replace(/[<>&"']/g, "");
  return `
    <html>
      <body style="font-family: system-ui; padding: 2rem;">
        <h1>${safeProvider} connected</h1>
        <p>This tab will close automatically. If it stays open, return to Tracker.</p>
        <script>
          setTimeout(() => window.close(), 500);
        </script>
      </body>
    </html>
  `;
}

function missingRequiredStringFields(
  data: Record<string, unknown>,
  fields: readonly string[],
): string[] {
  return fields.filter((field) => {
    const value = data[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

function missingFieldsError(fields: string[]) {
  return { error: `Missing required fields (${fields.join(", ")})` };
}

function invalidApplicationEnumFields(data: Record<string, unknown>): string[] {
  const invalidFields: string[] = [];

  if (typeof data.stage !== "string" || !VALID_STAGES.has(data.stage)) {
    invalidFields.push("stage");
  }

  if (
    typeof data.workMode !== "string" ||
    !VALID_WORK_MODES.has(data.workMode)
  ) {
    invalidFields.push("workMode");
  }

  return invalidFields;
}

function invalidFieldsError(fields: string[]) {
  return { error: `Invalid fields (${fields.join(", ")})` };
}

function oversizedApplicationStringFields(
  data: Record<string, unknown>,
): string[] {
  const oversizedFields: string[] = [];

  for (const [field, maxLength] of Object.entries(APPLICATION_STRING_LIMITS)) {
    const value = data[field];
    if (typeof value === "string" && value.length > maxLength) {
      oversizedFields.push(field);
    }
  }

  const checklist = data.checklist;
  if (Array.isArray(checklist)) {
    checklist.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return;
      }

      const text = (item as Record<string, unknown>).text;
      if (
        typeof text === "string" &&
        text.length > CHECKLIST_ITEM_TEXT_MAX_LENGTH
      ) {
        oversizedFields.push(`checklist[${index}].text`);
      }
    });
  }

  return oversizedFields;
}

function oversizedFieldsError(fields: string[]) {
  return { error: `Fields exceed maximum length (${fields.join(", ")})` };
}

// Initialize database
async function initDb(customDbPath?: string) {
  if (customDbPath) {
    DB_PATH = customDbPath;
  } else {
    DB_PATH = getDbPath();
  }
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
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
      checklist TEXT NOT NULL, -- JSON string
      contacts TEXT NOT NULL,  -- JSON string
      history TEXT NOT NULL   -- JSON string
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      fullName TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      title TEXT NOT NULL,
      bio TEXT NOT NULL,
      resumeText TEXT,
      resumeFileName TEXT,
      resumeFile TEXT,
      updatedAt TEXT NOT NULL
    );
  `);

  await ensureEmailAutomationTables(db);
}

// REST API Endpoints

// GET /api/health - Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// GET /api/applications - Get all applications
app.get("/api/applications", async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM applications");
    const applications = rows.map((row) => ({
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
    }));
    res.json(applications);
  } catch (error: any) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/applications - Create a new application
app.post("/api/applications", async (req, res) => {
  try {
    const appData: JobApplication = req.body;
    const missingFields = missingRequiredStringFields(
      appData as unknown as Record<string, unknown>,
      APPLICATION_REQUIRED_FIELDS,
    );
    if (missingFields.length > 0) {
      return res.status(400).json(missingFieldsError(missingFields));
    }
    const invalidFields = invalidApplicationEnumFields(
      appData as unknown as Record<string, unknown>,
    );
    if (invalidFields.length > 0) {
      return res.status(400).json(invalidFieldsError(invalidFields));
    }
    const oversizedFields = oversizedApplicationStringFields(
      appData as unknown as Record<string, unknown>,
    );
    if (oversizedFields.length > 0) {
      return res.status(400).json(oversizedFieldsError(oversizedFields));
    }

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

    res.status(201).json(appData);
  } catch (error: any) {
    console.error("Error creating application:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/applications/:id - Update an application
app.put("/api/applications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const appData: JobApplication = req.body;
    const missingFields = missingRequiredStringFields(
      appData as unknown as Record<string, unknown>,
      APPLICATION_REQUIRED_FIELDS,
    );
    if (missingFields.length > 0) {
      return res.status(400).json(missingFieldsError(missingFields));
    }
    const invalidFields = invalidApplicationEnumFields(
      appData as unknown as Record<string, unknown>,
    );
    if (invalidFields.length > 0) {
      return res.status(400).json(invalidFieldsError(invalidFields));
    }
    const oversizedFields = oversizedApplicationStringFields(
      appData as unknown as Record<string, unknown>,
    );
    if (oversizedFields.length > 0) {
      return res.status(400).json(oversizedFieldsError(oversizedFields));
    }

    const existing = await db.get("SELECT id FROM applications WHERE id = ?", [
      id,
    ]);
    if (!existing) {
      return res
        .status(404)
        .json({ error: `Application with ID ${id} not found` });
    }

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
        id,
      ],
    );

    res.json(appData);
  } catch (error: any) {
    console.error("Error updating application:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/applications/:id - Delete an application
app.delete("/api/applications/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.get("SELECT id FROM applications WHERE id = ?", [
      id,
    ]);
    if (!existing) {
      return res
        .status(404)
        .json({ error: `Application with ID ${id} not found` });
    }

    await db.run("DELETE FROM applications WHERE id = ?", [id]);
    res.json({ message: `Successfully deleted application ${id}` });
  } catch (error: any) {
    console.error("Error deleting application:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/parse-resume - Parse PDF resume base64 string
app.post("/api/parse-resume", async (req, res) => {
  try {
    const { resumeFile } = req.body;
    if (!resumeFile) {
      return res
        .status(400)
        .json({ error: "Missing required field: resumeFile (base64 string)" });
    }

    const text = await extractTextFromPdf(resumeFile);
    const parsed = parseResumeText(text);

    res.json({
      text,
      parsed,
    });
  } catch (error: any) {
    console.error("Error parsing PDF resume:", error);
    res
      .status(500)
      .json({ error: `Failed to parse PDF resume: ${error.message}` });
  }
});

// GET /api/profiles - Get all profiles
app.get("/api/profiles", async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM profiles ORDER BY updatedAt DESC");
    res.json(rows);
  } catch (error: any) {
    console.error("Error fetching profiles:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/profiles - Create or update a profile
app.post("/api/profiles", async (req, res) => {
  try {
    const profile = req.body;
    if (!profile.id || !profile.fullName) {
      return res
        .status(400)
        .json({ error: "Missing required fields (id, fullName)" });
    }

    const existing = await db.get("SELECT id FROM profiles WHERE id = ?", [
      profile.id,
    ]);
    if (existing) {
      // Update
      await db.run(
        `UPDATE profiles SET
          fullName = ?,
          email = ?,
          phone = ?,
          title = ?,
          bio = ?,
          resumeText = ?,
          resumeFileName = ?,
          resumeFile = ?,
          updatedAt = ?
        WHERE id = ?`,
        [
          profile.fullName,
          profile.email,
          profile.phone,
          profile.title,
          profile.bio,
          profile.resumeText || null,
          profile.resumeFileName || null,
          profile.resumeFile || null,
          new Date().toISOString(),
          profile.id,
        ],
      );
    } else {
      // Insert
      await db.run(
        `INSERT INTO profiles (
          id, fullName, email, phone, title, bio, resumeText, resumeFileName, resumeFile, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          profile.id,
          profile.fullName,
          profile.email,
          profile.phone,
          profile.title,
          profile.bio,
          profile.resumeText || null,
          profile.resumeFileName || null,
          profile.resumeFile || null,
          new Date().toISOString(),
        ],
      );
    }

    const saved = await db.get("SELECT * FROM profiles WHERE id = ?", [
      profile.id,
    ]);
    res.status(existing ? 200 : 201).json(saved);
  } catch (error: any) {
    console.error("Error saving profile:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/profiles/:id - Delete a profile
app.delete("/api/profiles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.get("SELECT id FROM profiles WHERE id = ?", [id]);
    if (!existing) {
      return res.status(404).json({ error: `Profile with ID ${id} not found` });
    }

    await db.run("DELETE FROM profiles WHERE id = ?", [id]);
    res.json({ message: `Successfully deleted profile ${id}` });
  } catch (error: any) {
    console.error("Error deleting profile:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/gmail/connect - Get the Google OAuth URL for local Gmail connection
app.get("/api/gmail/connect", async (req, res) => {
  try {
    const authUrl = await createGmailConnectUrl(db);
    res.json({ authUrl });
  } catch (error: any) {
    console.error("Error creating Gmail OAuth URL:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/gmail/oauth/callback - Complete Google OAuth flow
app.get("/api/gmail/oauth/callback", async (req, res) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) {
      return res.status(400).send("Missing Gmail OAuth code or state");
    }

    await handleGmailOAuthCallback(db, code, state);
    res.send(oauthSuccessHtml("Gmail"));
  } catch (error: any) {
    console.error("Error completing Gmail OAuth:", error);
    res.status(500).send(`Gmail connection failed: ${error.message}`);
  }
});

// GET /api/codex/connect - Get the ChatGPT Plus / Codex OAuth URL
app.get("/api/codex/connect", async (req, res) => {
  try {
    const authUrl = await createCodexConnectUrl(db);
    res.json({ authUrl });
  } catch (error: any) {
    console.error("Error creating Codex OAuth URL:", error);
    res.status(500).json({ error: error.message });
  }
});

async function completeCodexOAuth(req: express.Request, res: express.Response) {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) {
      return res.status(400).send("Missing Codex OAuth code or state");
    }

    await handleCodexOAuthCallback(db, code, state);
    res.send(oauthSuccessHtml("ChatGPT Plus"));
  } catch (error: any) {
    console.error("Error completing Codex OAuth:", error);
    res.status(500).send(`Codex connection failed: ${error.message}`);
  }
}

// GET /auth/callback - Official Codex CLI-compatible OAuth callback path
app.get("/auth/callback", completeCodexOAuth);

// GET /api/codex/oauth/callback - Backward-compatible local callback path
app.get("/api/codex/oauth/callback", completeCodexOAuth);

// POST /api/codex/import-cli-auth - Import local Codex CLI ChatGPT auth cache
app.post("/api/codex/import-cli-auth", async (req, res) => {
  try {
    await importCodexCliAuth(db);
    res.json(await getCodexStatus(db));
  } catch (error: any) {
    console.error("Error importing Codex CLI auth:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/codex/status - Get ChatGPT Plus / Codex connection status
app.get("/api/codex/status", async (req, res) => {
  try {
    res.json(await getCodexStatus(db));
  } catch (error: any) {
    console.error("Error fetching Codex status:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/codex/responses - Proxy OpenAI Responses API streaming with stored Codex OAuth token
app.post("/api/codex/responses", async (req, res) => {
  try {
    if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, "input")) {
      return res.status(400).json({ error: "Missing required field (input)" });
    }

    const upstream = await streamCodexResponse(db, req.body);
    res.status(upstream.status);
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "text/event-stream",
    );
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    if (!upstream.body) {
      return res.end();
    }

    const reader = upstream.body.getReader();
    let clientGone = false;
    res.on("close", () => {
      clientGone = true;
      void reader.cancel().catch(() => {});
    });
    while (true) {
      const { done, value } = await reader.read();
      if (done || clientGone) break;
      res.write(Buffer.from(value));
    }
    if (!clientGone) res.end();
  } catch (error: any) {
    console.error("Error streaming Codex response:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.end();
    }
  }
});

// GET /api/automation/status - Get Gmail automation health and counters
app.get("/api/automation/status", async (req, res) => {
  try {
    res.json(await getAutomationStatus(db));
  } catch (error: any) {
    console.error("Error fetching automation status:", error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/automation/settings - Update automation runtime settings
app.patch("/api/automation/settings", async (req, res) => {
  try {
    const { pollingEnabled, classifierProvider, classifierModel, nimApiKey, nimEndpointPath } = req.body;

    if (pollingEnabled !== undefined) {
      if (typeof pollingEnabled !== "boolean") {
        return res
          .status(400)
          .json({ error: "pollingEnabled must be a boolean" });
      }
      await setAutomationPollingEnabled(db, pollingEnabled);
    }

    if (classifierProvider !== undefined) {
      if (classifierProvider !== "nim" && classifierProvider !== "codex") {
        return res
          .status(400)
          .json({ error: 'classifierProvider must be "nim" or "codex"' });
      }
      await setSetting(db, "classifier_provider", classifierProvider);
    }

    if (classifierModel !== undefined) {
      if (typeof classifierModel !== "string") {
        return res
          .status(400)
          .json({ error: "classifierModel must be a string" });
      }
      await setSetting(db, "classifier_model", classifierModel);
    }

    if (nimApiKey !== undefined) {
      if (typeof nimApiKey !== "string") {
        return res.status(400).json({ error: "nimApiKey must be a string" });
      }
      await setSetting(db, "nim_api_key", nimApiKey);
    }

    if (nimEndpointPath !== undefined) {
      if (typeof nimEndpointPath !== "string") {
        return res.status(400).json({ error: "nimEndpointPath must be a string" });
      }
      await setSetting(db, "nim_endpoint_path", nimEndpointPath);
    }

    if (classifierProvider !== undefined || classifierModel !== undefined || nimApiKey !== undefined || nimEndpointPath !== undefined) {
      await setSetting(db, "last_scan_error", "");
    }

    res.json(await getAutomationStatus(db));
  } catch (error: any) {
    console.error("Error updating automation settings:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/automation/test-classifier - Verify selected classifier provider/model
app.post("/api/automation/test-classifier", async (req, res) => {
  try {
    const { classifierProvider, classifierModel, nimApiKey, nimEndpointPath } = req.body || {};

    if (classifierProvider !== "nim" && classifierProvider !== "codex") {
      return res
        .status(400)
        .json({ error: 'classifierProvider must be "nim" or "codex"' });
    }
    if (typeof classifierModel !== "string" || !classifierModel.trim()) {
      return res.status(400).json({ error: "classifierModel must be a non-empty string" });
    }

    res.json(
      await testClassifierConnection(db, {
        provider: classifierProvider,
        model: classifierModel,
        nimApiKey,
        nimEndpointPath,
      }),
    );
  } catch (error: any) {
    console.error("Error testing classifier connection:", error);
    if (error instanceof ClassifierConnectionError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /api/automation/scan - Manually run one Gmail automation scan
app.post("/api/automation/scan", async (req, res) => {
  try {
    const result = await runEmailAutomationScan(db);
    res.json(result);
  } catch (error: any) {
    console.error("Error running automation scan:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/automation/abort-scan - Abort the currently running manual or scheduled scan
app.post("/api/automation/abort-scan", async (req, res) => {
  try {
    abortEmailAutomationScan();
    res.json({ status: "aborting" });
  } catch (error: any) {
    console.error("Error aborting scan:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/automation/queue - Get uncertain/pending automation items
app.get("/api/automation/queue", async (req, res) => {
  try {
    res.json(await listAutomationQueue(db));
  } catch (error: any) {
    console.error("Error fetching automation queue:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/automation/queue/:id/apply - Apply a proposed automation action
app.post("/api/automation/queue/:id/apply", async (req, res) => {
  try {
    await applyAutomationQueueItem(db, req.params.id);
    res.json({ status: "applied" });
  } catch (error: any) {
    console.error("Error applying automation queue item:", error);
    res.status(400).json({ error: error.message });
  }
});

// POST /api/automation/queue/:id/ignore - Ignore an automation queue item
app.post("/api/automation/queue/:id/ignore", async (req, res) => {
  try {
    await ignoreAutomationQueueItem(db, req.params.id);
    res.json({ status: "ignored" });
  } catch (error: any) {
    console.error("Error ignoring automation queue item:", error);
    res.status(400).json({ error: error.message });
  }
});

// POST /api/automation/queue/:id/link - Link a queued email to an existing application
app.post("/api/automation/queue/:id/link", async (req, res) => {
  try {
    const applicationId =
      typeof req.body?.applicationId === "string" ? req.body.applicationId : "";
    if (!applicationId) {
      return res
        .status(400)
        .json({ error: "Missing required field (applicationId)" });
    }
    await linkAutomationQueueItem(db, req.params.id, applicationId);
    res.json({ status: "applied" });
  } catch (error: any) {
    console.error("Error linking automation queue item:", error);
    res.status(400).json({ error: error.message });
  }
});

// Create combined HTTP & WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket server logic
wss.on("connection", (ws: WebSocket) => {
  console.log("Backend: client connected via WebSocket");

  // Emit 'daemon.ready' handshake event to client on connection
  const readyEnvelope = {
    schemaVersion: "1.0",
    eventId: `evt-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    sessionId: `sess-${Date.now()}`,
    emittedAt: new Date().toISOString(),
    type: "daemon.ready",
    payload: { message: "SQLite Backend is ready and running" },
  };
  ws.send(JSON.stringify(readyEnvelope));

  // Set up periodic heartbeat messages
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          schemaVersion: "1.0",
          eventId: `evt-hb-${Date.now()}`,
          sessionId: readyEnvelope.sessionId,
          emittedAt: new Date().toISOString(),
          type: "heartbeat",
          payload: {},
        }),
      );
    }
  }, 30000);

  ws.on("message", (message: string) => {
    try {
      const data = JSON.parse(message);
      console.log("Backend: received message", data);

      // Echo it back or handle specialized commands if needed
      ws.send(
        JSON.stringify({
          schemaVersion: "1.0",
          eventId: `evt-echo-${Date.now()}`,
          sessionId: readyEnvelope.sessionId,
          emittedAt: new Date().toISOString(),
          type: "heartbeat",
          payload: { echo: true, original: data.type || "unknown" },
        }),
      );
    } catch (err) {
      console.error("Backend: error parsing message:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("Backend: WebSocket error:", err);
    clearInterval(heartbeatInterval);
  });

  ws.on("close", () => {
    console.log("Backend: client disconnected");
    clearInterval(heartbeatInterval);
  });
});

// Graceful shutdown handler
function setupGracefulShutdown() {
  const shutdown = () => {
    console.log("Backend: shutting down gracefully...");
    if (automationInterval) {
      clearInterval(automationInterval);
    }
    server.close(() => {
      console.log("Backend: server closed");
      process.exit(0);
    });
    // Force exit after 10 seconds if graceful shutdown didn't complete
    setTimeout(() => {
      console.error("Backend: forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Start the server
async function start() {
  try {
    validateNimEnvConfig();
    await initDb();
    console.log(`Backend: SQLite database initialized at ${DB_PATH}`);
    server.listen(PORT, () => {
      console.log(`Backend: REST and WS Server listening on port ${PORT}`);
    });
    if (process.env.NODE_ENV !== "test" && canStartGmailAutomation()) {
      const pollIntervalMs = Number(
        process.env.GMAIL_POLL_INTERVAL_MS || 10 * 60 * 1000,
      );
      automationInterval = setInterval(async () => {
        try {
          if (!(await isAutomationPollingEnabled(db))) {
            return;
          }

          await runEmailAutomationScan(db);
        } catch (error) {
          console.error("Gmail automation scan failed:", error);
        }
      }, pollIntervalMs);
      automationInterval.unref?.();
      console.log(`Backend: Gmail automation polling every ${pollIntervalMs}ms`);
    }
    setupGracefulShutdown();
  } catch (err) {
    console.error("Backend failed to start:", err);
    process.exit(1);
  }
}

// Support executing directly or being imported for testing
if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  start();
}

export { app, server, initDb, db, DB_PATH, getDbPath };

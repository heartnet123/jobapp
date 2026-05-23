import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { JobApplication } from '../types';

// ES Module dirname resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port and DB settings
const PORT = process.env.PORT || 3001;
const DB_PATH = path.resolve(
  __dirname,
  process.env.NODE_ENV === 'test' ? '../../jobs.test.db' : '../../jobs.db'
);

const app = express();
app.use(cors());
app.use(express.json());

let db: Database<sqlite3.Database, sqlite3.Statement>;

// Initialize database
async function initDb() {
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
  `);
}

// REST API Endpoints

// GET /api/applications - Get all applications
app.get('/api/applications', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM applications');
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
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/applications - Create a new application
app.post('/api/applications', async (req, res) => {
  try {
    const appData: JobApplication = req.body;
    if (!appData.id || !appData.company || !appData.role || !appData.stage) {
      return res.status(400).json({ error: 'Missing required fields (id, company, role, stage)' });
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
      ]
    );

    res.status(201).json(appData);
  } catch (error: any) {
    console.error('Error creating application:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/applications/:id - Update an application
app.put('/api/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const appData: JobApplication = req.body;

    const existing = await db.get('SELECT id FROM applications WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: `Application with ID ${id} not found` });
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
      ]
    );

    res.json(appData);
  } catch (error: any) {
    console.error('Error updating application:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/applications/:id - Delete an application
app.delete('/api/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.get('SELECT id FROM applications WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: `Application with ID ${id} not found` });
    }

    await db.run('DELETE FROM applications WHERE id = ?', [id]);
    res.json({ message: `Successfully deleted application ${id}` });
  } catch (error: any) {
    console.error('Error deleting application:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create combined HTTP & WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket server logic
wss.on('connection', (ws: WebSocket) => {
  console.log('Daemon: client connected via WebSocket');

  // Emit 'daemon.ready' handshake event to client on connection
  const readyEnvelope = {
    schemaVersion: '1.0',
    eventId: `evt-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    sessionId: `sess-${Date.now()}`,
    emittedAt: new Date().toISOString(),
    type: 'daemon.ready',
    payload: { message: 'SQLite Daemon is ready and running' },
  };
  ws.send(JSON.stringify(readyEnvelope));

  // Set up periodic heartbeat messages
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          schemaVersion: '1.0',
          eventId: `evt-hb-${Date.now()}`,
          sessionId: readyEnvelope.sessionId,
          emittedAt: new Date().toISOString(),
          type: 'heartbeat',
          payload: {},
        })
      );
    }
  }, 30000);

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);
      console.log('Daemon: received message', data);
      
      // Echo it back or handle specialized commands if needed
      ws.send(JSON.stringify({
        schemaVersion: '1.0',
        eventId: `evt-echo-${Date.now()}`,
        sessionId: readyEnvelope.sessionId,
        emittedAt: new Date().toISOString(),
        type: 'heartbeat',
        payload: { echo: true, original: data.type || 'unknown' }
      }));
    } catch (err) {
      console.error('Daemon: error parsing message:', err);
    }
  });

  ws.on('close', () => {
    console.log('Daemon: client disconnected');
    clearInterval(heartbeatInterval);
  });
});

// Start the server
async function start() {
  try {
    await initDb();
    console.log(`Daemon: SQLite database initialized at ${DB_PATH}`);
    server.listen(PORT, () => {
      console.log(`Daemon: REST and WS Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Daemon failed to start:', err);
    process.exit(1);
  }
}

// Support executing directly or being imported for testing
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  start();
}

export { app, server, initDb, db, DB_PATH };

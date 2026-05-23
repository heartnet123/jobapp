import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, server, initDb, db, DB_PATH } from './server';
import fs from 'fs';
import WebSocket from 'ws';
import type { JobApplication } from '../types';

// Set NODE_ENV to 'test' so we use jobs.test.db
process.env.NODE_ENV = 'test';

const TEST_PORT = 3010;

describe('SQLite Daemon Integration Tests', () => {
  beforeAll(async () => {
    // Delete old test database if it exists
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
    
    // Initialize Database
    await initDb();
    
    // Clear out table for tests
    await db.run('DELETE FROM applications');

    // Start Express + WebSocket server
    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, () => {
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Close servers
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    // Close Database
    await db.close();

    // Clean up test database file
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
  });

  const testApp: JobApplication = {
    id: 'APP-TEST-001',
    company: 'Test Company',
    role: 'Software Engineer',
    stage: 'Applied',
    date: '2026-05-23',
    salary: '$120,000',
    location: 'San Francisco, CA',
    workMode: 'Hybrid',
    url: 'https://example.com/test-job',
    notes: 'Testing notes content',
    checklist: [
      { id: 'c1', text: 'Resume updated', done: true },
      { id: 'c2', text: 'Prepare interview', done: false }
    ],
    reminderDate: '2026-05-30',
    contacts: [
      {
        id: 'con1',
        name: 'Jane Recruiter',
        role: 'Tech Recruiter',
        email: 'jane@example.com',
        phone: '123-456-7890',
        linkedIn: 'https://linkedin.com/in/jane',
        notes: 'Met at career fair'
      }
    ],
    history: [
      {
        id: 'log1',
        timestamp: new Date().toISOString(),
        type: 'creation',
        message: 'Opportunity tracked for Test Company'
      }
    ]
  };

  it('should create a new job application (POST /api/applications)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testApp),
    });

    expect(res.status).toBe(201);
    const data = await res.json() as JobApplication;
    expect(data.id).toBe(testApp.id);
    expect(data.company).toBe(testApp.company);
    expect(data.checklist).toHaveLength(2);
    expect(data.checklist[0].done).toBe(true);
    expect(data.contacts).toHaveLength(1);
    expect(data.history).toHaveLength(1);
  });

  it('should retrieve all job applications (GET /api/applications)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/applications`);
    expect(res.status).toBe(200);
    const data = await res.json() as JobApplication[];
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(testApp.id);
    expect(data[0].company).toBe(testApp.company);
    expect(data[0].checklist).toBeInstanceOf(Array);
    expect(data[0].checklist[0].text).toBe('Resume updated');
    expect(data[0].contacts![0].name).toBe('Jane Recruiter');
  });

  it('should update an existing job application (PUT /api/applications/:id)', async () => {
    const updatedApp: JobApplication = {
      ...testApp,
      stage: 'Interview',
      notes: 'Updated notes',
      checklist: [
        ...testApp.checklist,
        { id: 'c3', text: 'Technical interview ready', done: true }
      ]
    };

    const res = await fetch(`http://localhost:${TEST_PORT}/api/applications/${testApp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedApp),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as JobApplication;
    expect(data.stage).toBe('Interview');
    expect(data.notes).toBe('Updated notes');
    expect(data.checklist).toHaveLength(3);

    // Verify it is updated in SQLite DB
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/applications`);
    const allApps = await getRes.json() as JobApplication[];
    expect(allApps[0].stage).toBe('Interview');
    expect(allApps[0].notes).toBe('Updated notes');
    expect(allApps[0].checklist).toHaveLength(3);
    expect(allApps[0].checklist[2].text).toBe('Technical interview ready');
  });

  it('should handle WebSocket connection and handshake', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    const messagePromise = new Promise<string>((resolve) => {
      ws.on('message', (data: string) => {
        resolve(data);
      });
    });

    const readyMessage = await messagePromise;
    const readyEnv = JSON.parse(readyMessage);
    
    expect(readyEnv.schemaVersion).toBe('1.0');
    expect(readyEnv.type).toBe('daemon.ready');
    expect(readyEnv.payload.message).toContain('ready and running');

    ws.close();
  });

  it('should delete a job application (DELETE /api/applications/:id)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/applications/${testApp.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const deleteResult = await res.json() as { message: string };
    expect(deleteResult.message).toContain('Successfully deleted');

    // Verify DB is now empty
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/applications`);
    const allApps = await getRes.json() as JobApplication[];
    expect(allApps).toHaveLength(0);
  });
});

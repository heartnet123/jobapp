process.env.NODE_ENV = 'test';

import { describe, it, expect, beforeAll, afterAll } from '@rstest/core';
import { server, initDb, db, getDbPath } from './server';
import fs from 'fs';
import WebSocket from 'ws';
import type { JobApplication } from '@jobapp/shared';

const TEST_PORT = 3010;

describe('SQLite Daemon Integration Tests', () => {
  beforeAll(async () => {
    const testDbPath = getDbPath();
    // Delete old test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    // Initialize Database
    await initDb(testDbPath);
    
    // Clear out table for tests
    await db.run('DELETE FROM applications');
    await db.run('DELETE FROM profiles');

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
    const testDbPath = getDbPath();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
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
  it('should reject new job applications with missing required fields', async () => {
    const requiredFields = ['id', 'company', 'role', 'stage'] as const;

    for (const field of requiredFields) {
      const payload = { ...testApp } as Record<string, unknown>;
      delete payload[field];

      const res = await fetch(`http://localhost:${TEST_PORT}/api/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status, `missing ${field}`).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain(field);
    }

    const blankCompanyRes = await fetch(`http://localhost:${TEST_PORT}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...testApp, id: 'APP-TEST-BLANK-COMPANY', company: '   ' }),
    });

    expect(blankCompanyRes.status).toBe(400);
    const blankCompanyData = await blankCompanyRes.json() as { error: string };
    expect(blankCompanyData.error).toContain('company');
  });
  it('should reject new job applications with invalid enum fields', async () => {
    const invalidPayloads = [
      { field: 'stage', payload: { ...testApp, id: 'APP-TEST-BAD-STAGE', stage: 'Hired' } },
      { field: 'stage', payload: { ...testApp, id: 'APP-TEST-UNICODE-STAGE', stage: 'Interview\u0000Offer' } },
      { field: 'workMode', payload: { ...testApp, id: 'APP-TEST-BAD-WORK-MODE', workMode: 'Teleport' } },
      { field: 'workMode', payload: { ...testApp, id: 'APP-TEST-NONSTRING-WORK-MODE', workMode: 7 } },
    ];

    for (const { field, payload } of invalidPayloads) {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status, `invalid ${field}`).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain(field);
    }
  });
  it('should reject new job applications with oversized string fields', async () => {
    const oversizedPayloads = [
      { field: 'company', payload: { ...testApp, id: 'APP-TEST-LONG-COMPANY', company: 'C'.repeat(201) } },
      { field: 'notes', payload: { ...testApp, id: 'APP-TEST-LONG-NOTES', notes: 'N'.repeat(10001) } },
      { field: 'url', payload: { ...testApp, id: 'APP-TEST-LONG-URL', url: `https://example.com/${'u'.repeat(2049)}` } },
      {
        field: 'checklist[0].text',
        payload: {
          ...testApp,
          id: 'APP-TEST-LONG-CHECKLIST',
          checklist: [{ id: 'todo-long', text: 'T'.repeat(1001), done: false }],
        },
      },
    ];

    for (const { field, payload } of oversizedPayloads) {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status, `oversized ${field}`).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain(field);
    }
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
  it('should reject application updates with missing required fields', async () => {
    const requiredFields = ['id', 'company', 'role', 'stage'] as const;

    for (const field of requiredFields) {
      const payload = { ...testApp, stage: 'Interview' } as Record<string, unknown>;
      delete payload[field];

      const res = await fetch(`http://localhost:${TEST_PORT}/api/applications/${testApp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status, `missing ${field}`).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain(field);
    }

    const blankRoleRes = await fetch(`http://localhost:${TEST_PORT}/api/applications/${testApp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...testApp, role: '' }),
    });

    expect(blankRoleRes.status).toBe(400);
    const blankRoleData = await blankRoleRes.json() as { error: string };
    expect(blankRoleData.error).toContain('role');

    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/applications`);
    const allApps = await getRes.json() as JobApplication[];
    expect(allApps).toHaveLength(1);
    expect(allApps[0].id).toBe(testApp.id);
    expect(allApps[0].company).toBe(testApp.company);
    expect(allApps[0].role).toBe(testApp.role);
    expect(allApps[0].stage).toBe('Interview');
  });
  it('should reject application updates with invalid enum fields', async () => {
    const invalidPayloads = [
      { field: 'stage', payload: { ...testApp, stage: 'Screening' } },
      { field: 'stage', payload: { ...testApp, stage: 'applied' } },
      { field: 'workMode', payload: { ...testApp, workMode: 'Office' } },
      { field: 'workMode', payload: { ...testApp, workMode: 'Remote\nDELETE FROM applications' } },
    ];

    for (const { field, payload } of invalidPayloads) {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/applications/${testApp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status, `invalid ${field}`).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain(field);
    }

    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/applications`);
    const allApps = await getRes.json() as JobApplication[];
    expect(allApps).toHaveLength(1);
    expect(allApps[0].stage).toBe('Interview');
    expect(allApps[0].workMode).toBe(testApp.workMode);
  });
  it('should reject application updates with oversized string fields', async () => {
    const oversizedPayloads = [
      { field: 'company', payload: { ...testApp, company: 'C'.repeat(201) } },
      { field: 'notes', payload: { ...testApp, notes: 'N'.repeat(10001) } },
      { field: 'url', payload: { ...testApp, url: `https://example.com/${'u'.repeat(2049)}` } },
      {
        field: 'checklist[0].text',
        payload: {
          ...testApp,
          checklist: [{ id: 'todo-long', text: 'T'.repeat(1001), done: false }],
        },
      },
    ];

    for (const { field, payload } of oversizedPayloads) {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/applications/${testApp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status, `oversized ${field}`).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain(field);
    }

    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/applications`);
    const allApps = await getRes.json() as JobApplication[];
    expect(allApps).toHaveLength(1);
    expect(allApps[0].company).toBe(testApp.company);
    expect(allApps[0].notes).toBe('Updated notes');
    expect(allApps[0].url).toBe(testApp.url);
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

  it('should update automation polling settings without disabling manual scan endpoint', async () => {
    const invalidRes = await fetch(`http://localhost:${TEST_PORT}/api/automation/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollingEnabled: 'false' }),
    });

    expect(invalidRes.status).toBe(400);

    const disableRes = await fetch(`http://localhost:${TEST_PORT}/api/automation/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollingEnabled: false }),
    });

    expect(disableRes.status).toBe(200);
    const disabledStatus = await disableRes.json() as { schedulerEnabled: boolean };
    expect(disabledStatus.schedulerEnabled).toBe(false);

    const statusRes = await fetch(`http://localhost:${TEST_PORT}/api/automation/status`);
    expect(statusRes.status).toBe(200);
    const status = await statusRes.json() as { schedulerEnabled: boolean };
    expect(status.schedulerEnabled).toBe(false);

    const scanRes = await fetch(`http://localhost:${TEST_PORT}/api/automation/scan`, { method: 'POST' });
    expect(scanRes.status).toBe(500);
    const scanError = await scanRes.json() as { error: string };
    expect(scanError.error).toContain('Gmail is not connected');

    const enableRes = await fetch(`http://localhost:${TEST_PORT}/api/automation/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollingEnabled: true }),
    });

    expect(enableRes.status).toBe(200);
    const enabledStatus = await enableRes.json() as { schedulerEnabled: boolean };
    expect(enabledStatus.schedulerEnabled).toBe(true);
  });

  it('should validate classifier connection test requests', async () => {
    const invalidProviderRes = await fetch(`http://localhost:${TEST_PORT}/api/automation/test-classifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classifierProvider: 'openai', classifierModel: 'gpt-5.5' }),
    });
    expect(invalidProviderRes.status).toBe(400);

    const blankModelRes = await fetch(`http://localhost:${TEST_PORT}/api/automation/test-classifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classifierProvider: 'codex', classifierModel: '   ' }),
    });
    expect(blankModelRes.status).toBe(400);

    const missingCodexAuthRes = await fetch(`http://localhost:${TEST_PORT}/api/automation/test-classifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classifierProvider: 'codex', classifierModel: 'gpt-5.5' }),
    });
    expect(missingCodexAuthRes.status).toBe(409);
    const error = await missingCodexAuthRes.json() as { error: string };
    expect(error.error).toContain('not connected');
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

  const testProfile = {
    id: 'PROF-TEST-001',
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '555-0199',
    title: 'Vue Specialist',
    bio: 'Experienced frontend developer working with Vue 3 and Vite.',
    resumeText: 'Pasted resume content...',
    resumeFileName: 'resume.pdf',
    resumeFile: 'data:application/pdf;base64,YmFzZTY0Y29udGVudA=='
  };

  it('should create a new user profile (POST /api/profiles)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testProfile),
    });

    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.id).toBe(testProfile.id);
    expect(data.fullName).toBe(testProfile.fullName);
    expect(data.title).toBe(testProfile.title);
    expect(data.resumeFileName).toBe(testProfile.resumeFileName);
  });

  it('should retrieve all profiles (GET /api/profiles)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/profiles`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(testProfile.id);
    expect(data[0].fullName).toBe(testProfile.fullName);
  });

  it('should update an existing profile (POST /api/profiles with existing ID)', async () => {
    const updatedProfile = {
      ...testProfile,
      fullName: 'Jane Smith',
      title: 'Senior Vue Architect'
    };

    const res = await fetch(`http://localhost:${TEST_PORT}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedProfile),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.fullName).toBe('Jane Smith');
    expect(data.title).toBe('Senior Vue Architect');

    // Retrieve again to verify persistence
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/profiles`);
    const all = await getRes.json() as any[];
    expect(all[0].fullName).toBe('Jane Smith');
    expect(all[0].title).toBe('Senior Vue Architect');
  });

  it('should delete a user profile (DELETE /api/profiles/:id)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/profiles/${testProfile.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const deleteResult = await res.json() as { message: string };
    expect(deleteResult.message).toContain('Successfully deleted');

    // Verify DB is now empty
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/profiles`);
    const all = await getRes.json() as any[];
    expect(all).toHaveLength(0);
  });

  it('should export applications as JSON envelope (GET /api/export)', async () => {
    // Ensure testApp is in applications table
    await fetch(`http://localhost:${TEST_PORT}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testApp),
    });

    const res = await fetch(`http://localhost:${TEST_PORT}/api/export?format=json`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.version).toBe(1);
    expect(typeof data.exportedAt).toBe('string');
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.applications)).toBe(true);
    const exportedApp = data.applications.find((a: any) => a.id === testApp.id);
    expect(exportedApp).toBeDefined();
    expect(exportedApp.company).toBe(testApp.company);
  });

  it('should export applications as CSV (GET /api/export?format=csv)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/export?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('id,company,role,stage');
    expect(text).toContain(testApp.id);
    expect(text).toContain(testApp.company);
  });

  it('should import applications with skip duplicate resolution (POST /api/import)', async () => {
    const importPayload = {
      conflictPolicy: 'skip',
      applications: [
        {
          ...testApp,
          company: 'Should Not Overwrite In Skip Mode',
        },
        {
          id: 'APP-IMPORT-NEW-001',
          company: 'Brand New Import Co',
          role: 'Fullstack Dev',
          stage: 'Applied',
          date: '2026-09-08',
          salary: '$130,000',
          location: 'Remote',
          workMode: 'Remote',
          url: 'https://example.com/imported',
          notes: 'Imported via test',
          checklist: [],
          contacts: [],
          history: [],
        },
      ],
    };

    const res = await fetch(`http://localhost:${TEST_PORT}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importPayload),
    });

    expect(res.status).toBe(200);
    const summary = await res.json() as any;
    expect(summary.total).toBe(2);
    expect(summary.inserted).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.updated).toBe(0);

    // Verify existing app was not overwritten
    const checkRes = await fetch(`http://localhost:${TEST_PORT}/api/applications`);
    const all = await checkRes.json() as any[];
    const original = all.find((a) => a.id === testApp.id);
    expect(original.company).toBe(testApp.company);
  });

  it('should import applications with overwrite duplicate resolution (POST /api/import)', async () => {
    const importPayload = {
      conflictPolicy: 'overwrite',
      applications: [
        {
          ...testApp,
          company: 'Updated Via Overwrite Import',
        },
      ],
    };

    const res = await fetch(`http://localhost:${TEST_PORT}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importPayload),
    });

    expect(res.status).toBe(200);
    const summary = await res.json() as any;
    expect(summary.updated).toBe(1);
    expect(summary.skipped).toBe(0);

    // Verify app was updated
    const checkRes = await fetch(`http://localhost:${TEST_PORT}/api/applications`);
    const all = await checkRes.json() as any[];
    const updated = all.find((a) => a.id === testApp.id);
    expect(updated.company).toBe('Updated Via Overwrite Import');
  });

  it('should reject invalid import payload and rollback (POST /api/import)', async () => {
    const invalidPayload = {
      conflictPolicy: 'skip',
      applications: [
        {
          id: 'INVALID-APP',
          // missing company & role
          stage: 'InvalidStage',
        },
      ],
    };

    const res = await fetch(`http://localhost:${TEST_PORT}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload),
    });

    expect(res.status).toBe(400);
    const errData = await res.json() as any;
    expect(errData.error).toBeDefined();
  });

  it('should reject import records with malformed checklist, contacts, or history elements (POST /api/import)', async () => {
    const malformedChecklistPayload = {
      conflictPolicy: 'skip',
      applications: [
        {
          ...testApp,
          id: 'APP-MALFORMED-CHECKLIST',
          checklist: [null],
        },
      ],
    };

    const res1 = await fetch(`http://localhost:${TEST_PORT}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(malformedChecklistPayload),
    });

    expect(res1.status).toBe(400);
    const err1 = await res1.json() as any;
    expect(err1.error).toContain('checklist');

    const malformedContactPayload = {
      conflictPolicy: 'skip',
      applications: [
        {
          ...testApp,
          id: 'APP-MALFORMED-CONTACT',
          contacts: [null],
        },
      ],
    };

    const res2 = await fetch(`http://localhost:${TEST_PORT}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(malformedContactPayload),
    });

    expect(res2.status).toBe(400);
    const err2 = await res2.json() as any;
    expect(err2.error).toContain('contact');
  });

  it('should reject incomplete imports missing scalar NOT NULL fields with 400 not 500 (POST /api/import)', async () => {
    const missingDatePayload = {
      conflictPolicy: 'skip',
      applications: [
        {
          id: 'APP-MISSING-DATE',
          company: 'Acme Corp',
          role: 'Engineer',
          stage: 'Applied',
          workMode: 'Remote',
          salary: '$100k',
          location: 'Remote',
          url: 'https://example.com',
          notes: 'notes',
          // date omitted
        },
      ],
    };

    const res = await fetch(`http://localhost:${TEST_PORT}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(missingDatePayload),
    });

    expect(res.status).toBe(400);
    const err = await res.json() as any;
    expect(err.error).toContain('date');
  });

  it('should allow large imports exceeding 100 KB (POST /api/import)', async () => {
    // 15 apps with 8KB notes each > 120KB total
    const largeApps: JobApplication[] = Array.from({ length: 15 }, (_, i) => ({
      id: `APP-LARGE-${i}`,
      company: `Large Co ${i}`,
      role: 'Staff Engineer',
      stage: 'Applied',
      date: '2026-09-17',
      salary: '$200,000',
      location: 'Remote',
      workMode: 'Remote',
      url: `https://example.com/job/${i}`,
      notes: 'x'.repeat(8000),
      checklist: [],
      contacts: [],
      history: [],
    }));

    const res = await fetch(`http://localhost:${TEST_PORT}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conflictPolicy: 'overwrite', applications: largeApps }),
    });

    expect(res.status).toBe(200);
    const summary = await res.json() as any;
    expect(summary.total).toBe(15);
  });

  it('should reject non-object application items with 400 (POST /api/import)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applications: [null] }),
    });

    expect(res.status).toBe(400);
    const err = (await res.json()) as any;
    expect(err.error).toContain('must be an object');
  });

  it('should return 413 when import payload exceeds limit (POST /api/import)', async () => {
    const hugePayload = JSON.stringify({
      applications: [
        {
          ...testApp,
          notes: 'x'.repeat(11 * 1024 * 1024),
        },
      ],
    });

    const res = await fetch(`http://localhost:${TEST_PORT}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: hugePayload,
    });

    expect(res.status).toBe(413);
    const err = (await res.json()) as any;
    expect(err.error).toBe('Import payload exceeds maximum size limit');
  });

  it('should prevent import rollback from deleting concurrent saves', async () => {
    // Intercept db.run to throw when inserting second app in transaction
    const originalRun = db.run.bind(db);
    (db as any).run = async (sql: any, ...params: any[]) => {
      if (
        typeof sql === 'string' &&
        sql.includes('INSERT') &&
        Array.isArray(params[0]) &&
        params[0].includes('APP-FAIL-TRIGGER')
      ) {
        throw new Error('Simulated SQLite transaction failure');
      }
      return originalRun(sql, ...params);
    };

    const failingImportPayload = {
      conflictPolicy: 'skip',
      applications: [
        {
          ...testApp,
          id: 'APP-IMPORT-WILL-ROLLBACK',
          company: 'Should Rollback',
        },
        {
          ...testApp,
          id: 'APP-FAIL-TRIGGER',
        },
      ],
    };

    const concurrentApp: JobApplication = {
      id: 'APP-CONCURRENT-ALICE',
      company: 'Alice In Wonderland',
      role: 'Security Engineer',
      stage: 'Applied',
      date: '2026-09-17',
      salary: '$150,000',
      location: 'New York, NY',
      workMode: 'Remote',
      url: 'https://example.com/alice',
      notes: 'Alice app',
      checklist: [],
      contacts: [],
      history: [],
    };

    try {
      const [importRes, createRes] = await Promise.all([
        fetch(`http://localhost:${TEST_PORT}/api/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(failingImportPayload),
        }),
        fetch(`http://localhost:${TEST_PORT}/api/applications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(concurrentApp),
        }),
      ]);

      expect(importRes.status).toBe(500);
      expect(createRes.status).toBe(201);

      // Verify Alice was preserved and import was rolled back
      const getRes = await fetch(`http://localhost:${TEST_PORT}/api/applications`);
      const all = (await getRes.json()) as JobApplication[];
      expect(all.find((a) => a.id === 'APP-CONCURRENT-ALICE')).toBeDefined();
      expect(all.find((a) => a.id === 'APP-IMPORT-WILL-ROLLBACK')).toBeUndefined();
    } finally {
      db.run = originalRun;
    }
  });
});

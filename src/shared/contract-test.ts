import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isAgentScore,
  isAgentCandidate,
  isAgentProposedAction,
  isApprovalQueueItem,
  isAgentEnvelope,
  isAgentEventEnvelope
} from './agent-contract.ts';

// Resolve directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(filename: string): unknown {
  const content = fs.readFileSync(path.join(fixturesDir, filename), 'utf8');
  return JSON.parse(content);
}

test('Contract Guard - AgentScore', () => {
  const score = readFixture('agent-score.json');
  assert.strictEqual(isAgentScore(score), true, 'Valid score should pass');

  // Negative validation tests
  assert.strictEqual(isAgentScore({ ...(score as any), grade: 'Z' }), false, 'Invalid grade should fail');
  assert.strictEqual(isAgentScore({ ...(score as any), numeric: 105 }), false, 'Numeric score > 100 should fail');
  assert.strictEqual(isAgentScore({ ...(score as any), numeric: -5 }), false, 'Numeric score < 0 should fail');
  assert.strictEqual(isAgentScore({ ...(score as any), confidence: 1.5 }), false, 'Confidence > 1 should fail');
  
  // Scoring boundary alignment tests
  assert.strictEqual(isAgentScore({ ...(score as any), grade: 'A', numeric: 85 }), false, 'Mismatched grade/numeric should fail');
  assert.strictEqual(isAgentScore({ ...(score as any), grade: 'B', numeric: 85 }), true, 'Aligned B grade should pass');
});

test('Contract Guard - AgentCandidate', () => {
  const candidate = readFixture('agent-candidate.json');
  assert.strictEqual(isAgentCandidate(candidate), true, 'Valid candidate should pass');

  // Negative validation tests
  assert.strictEqual(isAgentCandidate({ ...(candidate as any), id: 'a'.repeat(200) }), false, 'Oversized ID string should fail');
  assert.strictEqual(isAgentCandidate({ ...(candidate as any), workMode: 'Invalid' }), false, 'Invalid work mode should fail');
  assert.strictEqual(isAgentCandidate({ ...(candidate as any), score: {} }), false, 'Invalid score object should fail');
});

test('Contract Guard - AgentProposedAction', () => {
  const actionCreate = readFixture('agent-proposed-action-create.json');
  const actionUpdate = readFixture('agent-proposed-action-update.json');
  const actionFollowup = readFixture('agent-proposed-action-followup.json');

  assert.strictEqual(isAgentProposedAction(actionCreate), true, 'Valid create action should pass');
  assert.strictEqual(isAgentProposedAction(actionUpdate), true, 'Valid update action should pass');
  assert.strictEqual(isAgentProposedAction(actionFollowup), true, 'Valid follow_up action should pass');

  // Negative validation tests
  assert.strictEqual(isAgentProposedAction({ ...(actionCreate as any), type: 'invalid_type' }), false, 'Invalid action type should fail');
  assert.strictEqual(isAgentProposedAction({ ...(actionFollowup as any), dueDate: 'not-a-date' }), false, 'Invalid due date should fail');
  assert.strictEqual(isAgentProposedAction({ ...(actionUpdate as any), patch: { stage: 'InvalidStage' } }), false, 'Invalid job application stage in patch should fail');
});

test('Contract Guard - ApprovalQueueItem', () => {
  const queueItem = readFixture('approval-queue-item.json');
  assert.strictEqual(isApprovalQueueItem(queueItem), true, 'Valid queue item should pass');

  // Negative validation tests
  assert.strictEqual(isApprovalQueueItem({ ...(queueItem as any), status: 'invalid_status' }), false, 'Invalid status should fail');
  assert.strictEqual(isApprovalQueueItem({ ...(queueItem as any), createdAt: '2026-99-99' }), false, 'Invalid createdAt date should fail');
});

test('Contract Guard - HTTP Envelope', () => {
  const env = readFixture('http-envelope.json');
  assert.strictEqual(isAgentEnvelope(env, isAgentCandidate), true, 'Valid HTTP candidate envelope should pass');

  // Negative validation tests
  assert.strictEqual(isAgentEnvelope({ ...(env as any), schemaVersion: '2.0' }, isAgentCandidate), false, 'Mismatched schemaVersion should fail');
  assert.strictEqual(isAgentEnvelope({ ...(env as any), emittedAt: 'invalid-date' }, isAgentCandidate), false, 'Invalid emittedAt date should fail');
});

test('Contract Guard - WebSocket Envelope', () => {
  const env = readFixture('websocket-envelope.json');
  assert.strictEqual(isAgentEventEnvelope(env, isAgentCandidate), true, 'Valid WebSocket candidate event envelope should pass');

  // Negative validation tests
  assert.strictEqual(isAgentEventEnvelope({ ...(env as any), type: 'invalid.event' }, isAgentCandidate), false, 'Invalid event type should fail');
});

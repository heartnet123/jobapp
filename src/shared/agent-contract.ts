import type { JobApplication } from '../types';

export type AgentGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type AgentActionType = 'create_application' | 'update_application' | 'follow_up';
export type ApprovalStatus = 'queued' | 'pending' | 'approved' | 'rejected' | 'applying' | 'applied' | 'failed';

export type AgentEventType =
  | 'daemon.ready'
  | 'scan.started'
  | 'scan.progress'
  | 'scan.result'
  | 'scan.completed'
  | 'scan.failed'
  | 'scan.cancelled'
  | 'daemon.error'
  | 'heartbeat';

export interface AgentEnvelope<T> {
  schemaVersion: '1.0';
  requestId?: string;
  sessionId: string;
  emittedAt: string;
  payload: T;
}

export interface AgentScore {
  grade: AgentGrade;
  numeric: number;
  confidence: number;
  blocks: {
    role_fit: number;
    compensation: number;
    work_mode_location: number;
    source_confidence: number;
    freshness: number;
    pipeline_priority: number;
  };
  rationale: string[];
}

export interface AgentCandidate {
  id: string;
  source: string;
  sourceUrl: string;
  company: string;
  role: string;
  location?: string;
  workMode?: 'Remote' | 'Hybrid' | 'On-site';
  salary?: string;
  score: AgentScore;
  raw?: unknown;
}

export type AgentProposedAction =
  | { id: string; type: 'create_application'; candidateId: string; payload: Partial<JobApplication>; reason: string }
  | { id: string; type: 'update_application'; applicationId: string; patch: Partial<JobApplication>; reason: string }
  | { id: string; type: 'follow_up'; applicationId: string; message: string; dueDate?: string; checklistText?: string; reason: string };

export interface ApprovalQueueItem {
  id: string;
  status: ApprovalStatus;
  action: AgentProposedAction;
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
}

export interface AgentEventEnvelope<T> {
  schemaVersion: '1.0';
  eventId: string;
  sessionId: string;
  scanId?: string;
  emittedAt: string;
  type: AgentEventType;
  payload: T;
}

// ==========================================
// Hand-Written Runtime Type Guards (Pure JS/TS)
// ==========================================

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maxLength = 4096): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && !isNaN(value) && value >= min && value <= max;
}

export function isValidDateString(value: unknown): value is string {
  if (!isString(value, 128)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

export function isAgentGrade(value: unknown): value is AgentGrade {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'F';
}

export function isAgentActionType(value: unknown): value is AgentActionType {
  return value === 'create_application' || value === 'update_application' || value === 'follow_up';
}

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return (
    value === 'queued' ||
    value === 'pending' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'applying' ||
    value === 'applied' ||
    value === 'failed'
  );
}

export function isAgentEventType(value: unknown): value is AgentEventType {
  return (
    value === 'daemon.ready' ||
    value === 'scan.started' ||
    value === 'scan.progress' ||
    value === 'scan.result' ||
    value === 'scan.completed' ||
    value === 'scan.failed' ||
    value === 'scan.cancelled' ||
    value === 'daemon.error' ||
    value === 'heartbeat'
  );
}

export function isAgentScore(value: unknown): value is AgentScore {
  if (!isObject(value)) return false;
  if (!isAgentGrade(value.grade)) return false;
  if (!isNumberInRange(value.numeric, 0, 100)) return false;
  if (!isNumberInRange(value.confidence, 0, 1)) return false;
  
  if (!isObject(value.blocks)) return false;
  const b = value.blocks;
  if (!isNumberInRange(b.role_fit, 0, 100)) return false;
  if (!isNumberInRange(b.compensation, 0, 100)) return false;
  if (!isNumberInRange(b.work_mode_location, 0, 100)) return false;
  if (!isNumberInRange(b.source_confidence, 0, 100)) return false;
  if (!isNumberInRange(b.freshness, 0, 100)) return false;
  if (!isNumberInRange(b.pipeline_priority, 0, 100)) return false;

  if (!Array.isArray(value.rationale)) return false;
  for (const item of value.rationale) {
    if (!isString(item, 4096)) return false;
  }
  
  // Scoring Grade boundary alignment assertion:
  // - A: numeric >= 90
  // - B: numeric >= 80
  // - C: numeric >= 70
  // - D: numeric >= 60
  // - F: numeric < 60
  const expectedGrade = 
    value.numeric >= 90 ? 'A' :
    value.numeric >= 80 ? 'B' :
    value.numeric >= 70 ? 'C' :
    value.numeric >= 60 ? 'D' : 'F';
  if (value.grade !== expectedGrade) return false;

  return true;
}

export function isAgentCandidate(value: unknown): value is AgentCandidate {
  if (!isObject(value)) return false;
  if (!isString(value.id, 128)) return false;
  if (!isString(value.source, 256)) return false;
  if (!isString(value.sourceUrl, 2048)) return false;
  if (!isString(value.company, 256)) return false;
  if (!isString(value.role, 256)) return false;
  
  if (value.location !== undefined && !isString(value.location, 256)) return false;
  if (value.workMode !== undefined && value.workMode !== 'Remote' && value.workMode !== 'Hybrid' && value.workMode !== 'On-site') return false;
  if (value.salary !== undefined && !isString(value.salary, 256)) return false;
  
  if (!isAgentScore(value.score)) return false;
  return true;
}

export function isPartialJobApplication(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.company !== undefined && !isString(value.company, 256)) return false;
  if (value.role !== undefined && !isString(value.role, 256)) return false;
  if (
    value.stage !== undefined &&
    value.stage !== 'Applied' &&
    value.stage !== 'Take-home' &&
    value.stage !== 'Interview' &&
    value.stage !== 'Offer' &&
    value.stage !== 'Rejected'
  ) return false;
  if (value.date !== undefined && !isString(value.date, 128)) return false;
  if (value.salary !== undefined && !isString(value.salary, 256)) return false;
  if (value.location !== undefined && !isString(value.location, 256)) return false;
  if (value.workMode !== undefined && value.workMode !== 'Remote' && value.workMode !== 'Hybrid' && value.workMode !== 'On-site') return false;
  if (value.url !== undefined && !isString(value.url, 2048)) return false;
  if (value.notes !== undefined && !isString(value.notes, 16384)) return false;
  return true;
}

export function isAgentProposedAction(value: unknown): value is AgentProposedAction {
  if (!isObject(value)) return false;
  if (!isString(value.id, 128)) return false;
  if (!isAgentActionType(value.type)) return false;
  if (!isString(value.reason, 4096)) return false;

  if (value.type === 'create_application') {
    if (!isString(value.candidateId, 128)) return false;
    if (!isPartialJobApplication(value.payload)) return false;
    return true;
  } else if (value.type === 'update_application') {
    if (!isString(value.applicationId, 128)) return false;
    if (!isPartialJobApplication(value.patch)) return false;
    return true;
  } else if (value.type === 'follow_up') {
    if (!isString(value.applicationId, 128)) return false;
    if (!isString(value.message, 4096)) return false;
    if (value.dueDate !== undefined && !isValidDateString(value.dueDate)) return false;
    if (value.checklistText !== undefined && !isString(value.checklistText, 1024)) return false;
    return true;
  }
  return false;
}

export function isApprovalQueueItem(value: unknown): value is ApprovalQueueItem {
  if (!isObject(value)) return false;
  if (!isString(value.id, 128)) return false;
  if (!isApprovalStatus(value.status)) return false;
  if (!isAgentProposedAction(value.action)) return false;
  if (!isValidDateString(value.createdAt)) return false;
  if (!isValidDateString(value.updatedAt)) return false;
  if (value.failureReason !== undefined && !isString(value.failureReason, 4096)) return false;
  return true;
}

export function isAgentEnvelope<T>(
  value: unknown,
  payloadGuard: (p: unknown) => p is T
): value is AgentEnvelope<T> {
  if (!isObject(value)) return false;
  if (value.schemaVersion !== '1.0') return false;
  if (value.requestId !== undefined && !isString(value.requestId, 128)) return false;
  if (!isString(value.sessionId, 128)) return false;
  if (!isValidDateString(value.emittedAt)) return false;
  return payloadGuard(value.payload);
}

export function isAgentEventEnvelope<T>(
  value: unknown,
  payloadGuard: (p: unknown) => p is T
): value is AgentEventEnvelope<T> {
  if (!isObject(value)) return false;
  if (value.schemaVersion !== '1.0') return false;
  if (!isString(value.eventId, 128)) return false;
  if (!isString(value.sessionId, 128)) return false;
  if (value.scanId !== undefined && !isString(value.scanId, 128)) return false;
  if (!isValidDateString(value.emittedAt)) return false;
  if (!isAgentEventType(value.type)) return false;
  return payloadGuard(value.payload);
}

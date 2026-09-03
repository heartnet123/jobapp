import type { JobApplication } from "./types.ts";

export type EmailAutomationCategory =
  | "application_submitted"
  | "rejection"
  | "closed_or_expired"
  | "interview_or_next_step"
  | "not_job_related"
  | "uncertain";

export type EmailAutomationAction =
  | "create_application"
  | "mark_rejected"
  | "queue_review"
  | "ignore";
export type AutomationQueueStatus =
  | "pending"
  | "applied"
  | "ignored"
  | "failed";

export interface EmailAutomationDecision {
  category: EmailAutomationCategory;
  confidence: number;
  company?: string;
  role?: string;
  eventDate?: string;
  workMode?: JobApplication["workMode"];
  location?: string;
  salary?: string;
  sourceUrl?: string;
  recommendedAction: EmailAutomationAction;
  reason: string;
}

export interface GmailMessageEvidence {
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  senderDomain: string;
  receivedAt: string;
  snippet: string;
}

export interface EmailAutomationQueueItem {
  id: string;
  messageId: string;
  status: AutomationQueueStatus;
  action: EmailAutomationAction;
  decision: EmailAutomationDecision;
  evidence: GmailMessageEvidence;
  proposedApplication?: Partial<JobApplication>;
  matchedApplicationId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type ClassifierProvider = "nim" | "codex";

export interface GmailAutomationStatus {
  gmailConnected: boolean;
  gmailConfigured: boolean;
  hasRefreshToken: boolean;
  expiresAt?: number;
  nimConfigured: boolean;
  nimApiKey?: string;
  schedulerEnabled: boolean;
  pollIntervalMs: number;
  lastScanAt?: string;
  lastScanStatus?: "completed" | "failed" | "running";
  lastScanError?: string;
  pendingQueueCount: number;
  processedMessageCount: number;
  classifierProvider?: ClassifierProvider;
  classifierModel?: string;
  scanProgressProcessed?: number;
  scanProgressTotal?: number;
}

export interface ClassifierConnectionTestResponse {
  ok: boolean;
  provider: ClassifierProvider;
  model: string;
  message: string;
  latencyMs?: number;
}

export interface CodexConnectionStatus {
  codexConnected: boolean;
  codexConfigured: boolean;
  chatgptAccountId?: string;
  chatgptPlanType?: string;
  expiresAt?: number;
  hasRefreshToken: boolean;
  lastRefreshAt?: string;
  lastError?: string;
}

export interface CodexConnectResponse {
  authUrl: string;
}

export interface CodexResponseRequest {
  model?: string;
  input: unknown;
  instructions?: string;
  previousResponseId?: string;
  metadata?: Record<string, unknown>;
}

const CATEGORIES: EmailAutomationCategory[] = [
  "application_submitted",
  "rejection",
  "closed_or_expired",
  "interview_or_next_step",
  "not_job_related",
  "uncertain",
];

const ACTIONS: EmailAutomationAction[] = [
  "create_application",
  "mark_rejected",
  "queue_review",
  "ignore",
];
const WORK_MODES: JobApplication["workMode"][] = [
  "Remote",
  "Hybrid",
  "On-site",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maxLength = 4096): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isNumberInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

export function isEmailAutomationCategory(
  value: unknown,
): value is EmailAutomationCategory {
  return (
    typeof value === "string" &&
    CATEGORIES.includes(value as EmailAutomationCategory)
  );
}

export function isEmailAutomationAction(
  value: unknown,
): value is EmailAutomationAction {
  return (
    typeof value === "string" &&
    ACTIONS.includes(value as EmailAutomationAction)
  );
}

export function isEmailAutomationDecision(
  value: unknown,
): value is EmailAutomationDecision {
  if (!isObject(value)) return false;
  if (!isEmailAutomationCategory(value.category)) return false;
  if (!isNumberInRange(value.confidence, 0, 1)) return false;
  if (!isEmailAutomationAction(value.recommendedAction)) return false;
  if (!isString(value.reason, 2048)) return false;

  if (value.company !== undefined && !isString(value.company, 256))
    return false;
  if (value.role !== undefined && !isString(value.role, 256)) return false;
  if (value.eventDate !== undefined && !isString(value.eventDate, 128))
    return false;
  if (
    value.workMode !== undefined &&
    !WORK_MODES.includes(value.workMode as JobApplication["workMode"])
  )
    return false;
  if (value.location !== undefined && !isString(value.location, 256))
    return false;
  if (value.salary !== undefined && !isString(value.salary, 256)) return false;
  if (value.sourceUrl !== undefined && !isString(value.sourceUrl, 2048))
    return false;
  return true;
}

export const emailAutomationDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "confidence", "recommendedAction", "reason", "company", "role"],
  properties: {
    category: { type: "string", enum: CATEGORIES },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    company: { type: "string", maxLength: 256 },
    role: { type: "string", maxLength: 256 },
    eventDate: { type: "string", maxLength: 128 },
    workMode: { type: "string", enum: WORK_MODES },
    location: { type: "string", maxLength: 256 },
    salary: { type: "string", maxLength: 256 },
    sourceUrl: { type: "string", maxLength: 2048 },
    recommendedAction: { type: "string", enum: ACTIONS },
    reason: { type: "string", maxLength: 2048 },
  },
} as const;

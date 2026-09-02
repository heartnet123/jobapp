import type {
  JobApplication,
  EmailAutomationAction,
  EmailAutomationDecision,
  GmailMessageEvidence,
} from '@jobapp/shared';
import { findBestJobMatches, getConfidentSingleMatch } from './jobMatcher';

export interface DecisionOutcome {
  action: EmailAutomationAction;
  autoApply: boolean;
  matchedApplication?: JobApplication;
  proposedApplication?: JobApplication;
  reason: string;
}

export interface DecisionThresholds {
  auto: number;
  review: number;
}

const DEFAULT_THRESHOLDS: DecisionThresholds = {
  auto: 0.85,
  review: 0.5,
};

export function createApplicationFromDecision(
  decision: EmailAutomationDecision,
  evidence: GmailMessageEvidence
): JobApplication {
  const now = new Date().toISOString();
  return {
    id: `APP-AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    company: decision.company?.trim() || 'Unknown company',
    role: decision.role?.trim() || 'Unknown role',
    stage: 'Applied',
    date: decision.eventDate || evidence.receivedAt || now,
    salary: decision.salary || 'TBD',
    location: decision.location || '',
    workMode: decision.workMode || 'Hybrid',
    url: decision.sourceUrl || '',
    notes: [
      `Created from Gmail automation.`,
      `Subject: ${evidence.subject}`,
      `Sender: ${evidence.sender}`,
      `Reason: ${decision.reason}`,
      `Gmail message: ${evidence.messageId}`,
    ].join('\n'),
    checklist: [],
    contacts: [],
    history: [
      {
        id: `log-${Date.now()}-automation-create-${Math.floor(Math.random() * 10000)}`,
        timestamp: now,
        type: 'creation',
        message: `Created automatically from Gmail message ${evidence.messageId}`,
      },
    ],
  };
}

export function decideEmailAutomationOutcome(
  decision: EmailAutomationDecision,
  evidence: GmailMessageEvidence,
  applications: JobApplication[],
  thresholds: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionOutcome {
  if (decision.confidence < thresholds.review || decision.category === 'not_job_related') {
    return {
      action: 'ignore',
      autoApply: true,
      reason: `Ignored because category is ${decision.category} with confidence ${decision.confidence}.`,
    };
  }

  const matches = findBestJobMatches(applications, {
    company: decision.company,
    role: decision.role,
    senderDomain: evidence.senderDomain,
    subject: evidence.subject,
  });
  const singleMatch = getConfidentSingleMatch(matches);

  if (decision.category === 'application_submitted') {
    if (!decision.company || !decision.role) {
      return {
        action: 'queue_review',
        autoApply: false,
        reason: 'Application email is missing company or role.',
      };
    }

    if (singleMatch) {
      return {
        action: 'queue_review',
        autoApply: false,
        matchedApplication: singleMatch.application,
        reason: 'Potential duplicate application needs review.',
      };
    }

    const proposedApplication = createApplicationFromDecision(decision, evidence);
    return {
      action: 'create_application',
      autoApply: decision.confidence >= thresholds.auto,
      proposedApplication,
      reason:
        decision.confidence >= thresholds.auto
          ? 'High-confidence application confirmation can be created automatically.'
          : 'Application confirmation needs review because confidence is below the auto threshold.',
    };
  }

  if (decision.category === 'rejection' || decision.category === 'closed_or_expired') {
    if (!singleMatch) {
      return {
        action: 'queue_review',
        autoApply: false,
        reason: 'Status email could not be matched to exactly one existing application.',
      };
    }

    return {
      action: 'mark_rejected',
      autoApply: decision.confidence >= thresholds.auto,
      matchedApplication: singleMatch.application,
      reason:
        decision.confidence >= thresholds.auto
          ? 'High-confidence rejection/closed status matched one existing application.'
          : 'Status email matched one application but confidence is below the auto threshold.',
    };
  }

  return {
    action: 'queue_review',
    autoApply: false,
    matchedApplication: singleMatch?.application,
    reason: `${decision.category} emails require review in the MVP.`,
  };
}

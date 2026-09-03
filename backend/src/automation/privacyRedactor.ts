export interface RedactedEmailContent {
  subject: string;
  senderDomain: string;
  receivedAt: string;
  snippet: string;
  bodyExcerpt: string;
}

const MAX_BODY_EXCERPT_LENGTH = 4000;
const MAX_SNIPPET_LENGTH = 512;

export function extractSenderDomain(sender: string): string {
  const emailMatch = sender.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (emailMatch) return emailMatch[1].toLowerCase();

  const domainMatch = sender.match(/@?([A-Z0-9.-]+\.[A-Z]{2,})/i);
  return domainMatch ? domainMatch[1].toLowerCase() : '';
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[url]')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[phone]')
    .replace(/\b(?:Bearer|token|code|otp|password|passcode)\s*[:=]?\s*[A-Z0-9._~+/=-]{6,}\b/gi, '$1 [secret]')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildRedactedEmailContent(input: {
  subject: string;
  sender: string;
  receivedAt: string;
  snippet: string;
  bodyText: string;
}): RedactedEmailContent {
  return {
    subject: redactSensitiveText(input.subject).slice(0, 300),
    senderDomain: extractSenderDomain(input.sender),
    receivedAt: input.receivedAt,
    snippet: redactSensitiveText(input.snippet).slice(0, MAX_SNIPPET_LENGTH),
    bodyExcerpt: redactSensitiveText(input.bodyText).slice(0, MAX_BODY_EXCERPT_LENGTH),
  };
}

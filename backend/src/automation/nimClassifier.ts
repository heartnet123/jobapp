import {
  emailAutomationDecisionJsonSchema,
  isEmailAutomationDecision,
  type EmailAutomationDecision,
} from '@jobapp/shared';
import type { RedactedEmailContent } from './privacyRedactor';

export interface NimClassifierConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  endpointPath?: string;
}

export class NimConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NimConfigurationError';
  }
}

export const CHAT_COMPLETIONS_PATH = '/chat/completions';

export function normalizeNimBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl) {
    return 'https://integrate.api.nvidia.com/v1';
  }

  let url = baseUrl.trim();

  // Strip trailing slashes first
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }

  // Strip trailing /chat/completions path if present
  if (url.endsWith(CHAT_COMPLETIONS_PATH)) {
    url = url.slice(0, -CHAT_COMPLETIONS_PATH.length);
  }

  // Strip trailing slashes again just in case
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }

  return url || 'https://integrate.api.nvidia.com/v1';
}

let lastLoggedConfig: { baseUrl: string; model: string; apiKeySource: string } | null = null;

export function logNimConfig(config: NimClassifierConfig, apiKeySource: string): void {
  const normalizedBaseUrl = normalizeNimBaseUrl(config.baseUrl);
  const model = config.model || 'Unknown';

  if (
    !lastLoggedConfig ||
    lastLoggedConfig.baseUrl !== normalizedBaseUrl ||
    lastLoggedConfig.model !== model ||
    lastLoggedConfig.apiKeySource !== apiKeySource
  ) {
    lastLoggedConfig = { baseUrl: normalizedBaseUrl, model, apiKeySource };
    console.log(
      `[NIM]\n` +
      `Base URL: ${normalizedBaseUrl}\n` +
      `Model: ${model}\n` +
      `API Key Source: ${apiKeySource}`
    );
  }
}

export function validateNimEnvConfig(env = process.env): void {
  const rawUrl = env.NVIDIA_NIM_BASE_URL || env.NIM_BASE_URL;
  if (rawUrl && rawUrl.includes(CHAT_COMPLETIONS_PATH)) {
    const normalized = normalizeNimBaseUrl(rawUrl);
    console.warn(
      `[NIM] Base URL should not include ${CHAT_COMPLETIONS_PATH}.\n` +
      `Automatically normalizing:\n` +
      `${rawUrl}\n` +
      `→ ${normalized}`
    );
  }
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('NIM response did not contain a JSON object');
    return JSON.parse(match[0]);
  }
}

export function getNimConfigFromEnv(env = process.env): NimClassifierConfig {
  return {
    apiKey: env.NVIDIA_NIM_API_KEY || env.NIM_API_KEY,
    model: env.NVIDIA_NIM_MODEL || env.NIM_MODEL,
    baseUrl: env.NVIDIA_NIM_BASE_URL || env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    endpointPath: env.NVIDIA_NIM_ENDPOINT_PATH || env.NIM_ENDPOINT_PATH,
  };
}

export function isNimConfigured(config = getNimConfigFromEnv()): boolean {
  return Boolean(config.apiKey && config.model);
}

export async function testNimConnection(
  config = getNimConfigFromEnv(),
  signal?: AbortSignal,
): Promise<void> {
  if (!config.apiKey) {
    throw new NimConfigurationError('Missing NVIDIA_NIM_API_KEY');
  }
  if (!config.model) {
    throw new NimConfigurationError('Missing NVIDIA_NIM_MODEL');
  }

  const normalized = normalizeNimBaseUrl(config.baseUrl);
  const endpointPath = config.endpointPath || CHAT_COMPLETIONS_PATH;
  const endpoint = `${normalized}${endpointPath}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 1,
      messages: [
        { role: 'user', content: 'Reply with ok.' },
      ],
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NIM connection test failed (${res.status}): ${body.slice(0, 500)}`);
  }
}

export async function classifyJobEmailWithNim(
  email: RedactedEmailContent,
  config = getNimConfigFromEnv(),
  signal?: AbortSignal,
): Promise<EmailAutomationDecision> {
  if (!config.apiKey) {
    throw new NimConfigurationError('Missing NVIDIA_NIM_API_KEY');
  }
  if (!config.model) {
    throw new NimConfigurationError('Missing NVIDIA_NIM_MODEL');
  }

  const normalized = normalizeNimBaseUrl(config.baseUrl);
  const endpointPath = config.endpointPath || CHAT_COMPLETIONS_PATH;
  const endpoint = `${normalized}${endpointPath}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'email_automation_decision',
          strict: true,
          schema: emailAutomationDecisionJsonSchema,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'Classify job-application emails. Return only JSON matching the schema. ' +
            'You MUST identify and extract the company name into the "company" field, and the job title/position into the "role" field. ' +
            'If the company name or job title/role cannot be determined, set them to "Unknown" or "". ' +
            'Use application_submitted for submitted/applied confirmations, rejection for rejected/not selected, ' +
            'closed_or_expired for closed/expired job posts, interview_or_next_step for interviews/assessments, ' +
            'not_job_related for unrelated mail, and uncertain when evidence is weak. Prefer queue_review unless action is clear.',
        },
        {
          role: 'user',
          content: JSON.stringify(email),
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NIM classification failed (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('NIM response did not include message content');
  }

  const parsed = parseJsonObject(content);
  if (!isEmailAutomationDecision(parsed)) {
    throw new Error('NIM response failed email automation schema validation');
  }
  return parsed;
}

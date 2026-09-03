import { Buffer } from 'node:buffer';

export interface GmailTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
}

export interface GmailOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
}

export interface GmailMessageContent {
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  receivedAt: string;
  snippet: string;
  bodyText: string;
}

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export class GmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailConfigurationError';
  }
}

export function getGmailOAuthConfig(env = process.env): GmailOAuthConfig {
  const port = env.PORT || '3001';
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI || `http://localhost:${port}/api/gmail/oauth/callback`,
  };
}

export function isGmailOAuthConfigured(config = getGmailOAuthConfig()): boolean {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

export function buildGmailAuthUrl(state: string, config = getGmailOAuthConfig()): string {
  if (!config.clientId || !config.clientSecret) {
    throw new GmailConfigurationError('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET');
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGmailAuthCode(code: string, config = getGmailOAuthConfig()): Promise<GmailTokenSet> {
  if (!config.clientId || !config.clientSecret) {
    throw new GmailConfigurationError('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    throw new Error(`Gmail OAuth token exchange failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

export async function refreshGmailAccessToken(
  refreshToken: string,
  config = getGmailOAuthConfig()
): Promise<GmailTokenSet> {
  if (!config.clientId || !config.clientSecret) {
    throw new GmailConfigurationError('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`Gmail OAuth refresh failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

async function gmailFetch<T>(path: string, accessToken: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Gmail API request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function listRecentGmailMessages(accessToken: string, maxResults = 100, signal?: AbortSignal): Promise<GmailMessageSummary[]> {
  const query = encodeURIComponent('in:inbox newer_than:30d');
  const data = await gmailFetch<{ messages?: GmailMessageSummary[] }>(
    `/users/me/messages?q=${query}&maxResults=${maxResults}`,
    accessToken,
    signal
  );
  return data.messages || [];
}

function decodeBase64Url(data?: string): string {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function collectTextParts(payload: any): string[] {
  if (!payload) return [];
  const mimeType = String(payload.mimeType || '').toLowerCase();
  const current = mimeType === 'text/plain' || mimeType === 'text/html' ? decodeBase64Url(payload.body?.data) : '';
  const children = Array.isArray(payload.parts) ? payload.parts.flatMap(collectTextParts) : [];
  return [current, ...children].filter(Boolean);
}

function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || '';
}

export async function getGmailMessageContent(accessToken: string, messageId: string, signal?: AbortSignal): Promise<GmailMessageContent> {
  const data = await gmailFetch<any>(`/users/me/messages/${messageId}?format=full`, accessToken, signal);
  const headers = data.payload?.headers as Array<{ name: string; value: string }> | undefined;
  const bodyText = collectTextParts(data.payload).map(stripHtml).join(' ').replace(/\s+/g, ' ').trim();

  return {
    messageId: data.id,
    threadId: data.threadId,
    subject: getHeader(headers, 'Subject'),
    sender: getHeader(headers, 'From'),
    receivedAt: new Date(Number(data.internalDate || Date.now())).toISOString(),
    snippet: data.snippet || '',
    bodyText,
  };
}

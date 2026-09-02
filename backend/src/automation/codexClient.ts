import crypto from "node:crypto";

export interface CodexTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
  chatgptAccountId?: string;
  chatgptPlanType?: string;
}

export interface CodexOAuthConfig {
  clientId?: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  accountUrl: string;
  scope: string;
}

export interface CodexPkcePair {
  verifier: string;
  challenge: string;
}

export interface CodexResponseInput {
  model?: string;
  input: unknown;
  instructions?: string;
  previousResponseId?: string;
  metadata?: Record<string, unknown>;
}

export const DEFAULT_DAEMON_PORT = 1455;
const DEFAULT_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_CODEX_AUTH_URL = "https://auth.openai.com/oauth/authorize";
const DEFAULT_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const DEFAULT_CODEX_ACCOUNT_URL =
  "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";
const DEFAULT_CODEX_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";
const DEFAULT_CODEX_RESPONSES_URL =
  "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_RESPONSES_MODEL = "gpt-5";

export class CodexConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexConfigurationError";
  }
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createCodexPkcePair(): CodexPkcePair {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

export function getCodexOAuthConfig(env = process.env): CodexOAuthConfig {
  const daemonPort = env.PORT || String(DEFAULT_DAEMON_PORT);
  return {
    clientId: env.OPENAI_CODEX_CLIENT_ID || DEFAULT_CODEX_CLIENT_ID,
    redirectUri:
      env.OPENAI_CODEX_REDIRECT_URI ||
      `http://localhost:${daemonPort}/auth/callback`,
    authUrl: env.OPENAI_CODEX_AUTH_URL || DEFAULT_CODEX_AUTH_URL,
    tokenUrl: env.OPENAI_CODEX_TOKEN_URL || DEFAULT_CODEX_TOKEN_URL,
    accountUrl: env.OPENAI_CODEX_ACCOUNT_URL || DEFAULT_CODEX_ACCOUNT_URL,
    scope: env.OPENAI_CODEX_SCOPE || DEFAULT_CODEX_SCOPE,
  };
}

export function isCodexOAuthConfigured(env = process.env): boolean {
  return Boolean(env.OPENAI_CODEX_CLIENT_ID && env.OPENAI_CODEX_REDIRECT_URI);
}

export function buildCodexAuthUrl(
  state: string,
  codeChallenge: string,
  config = getCodexOAuthConfig(),
): string {
  if (!config.clientId) {
    throw new CodexConfigurationError("Missing OPENAI_CODEX_CLIENT_ID");
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "pi",
  });
  return `${config.authUrl}?${params.toString()}`;
}

function tokenFromResponse(
  data: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    account_id?: string;
    chatgpt_account_id?: string;
    plan_type?: string;
    chatgpt_plan_type?: string;
  },
  fallbackRefreshToken?: string,
): CodexTokenSet {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || fallbackRefreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope,
    tokenType: data.token_type,
    chatgptAccountId: data.chatgpt_account_id || data.account_id,
    chatgptPlanType: data.chatgpt_plan_type || data.plan_type,
  };
}

export async function exchangeCodexAuthCode(
  code: string,
  codeVerifier: string,
  config = getCodexOAuthConfig(),
): Promise<CodexTokenSet> {
  if (!config.clientId) {
    throw new CodexConfigurationError("Missing OPENAI_CODEX_CLIENT_ID");
  }

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Codex OAuth token exchange failed (${res.status}): ${(await res.text()).slice(0, 500)}`,
    );
  }

  return tokenFromResponse((await res.json()) as any);
}

export async function refreshCodexAccessToken(
  refreshToken: string,
  config = getCodexOAuthConfig(),
): Promise<CodexTokenSet> {
  if (!config.clientId) {
    throw new CodexConfigurationError("Missing OPENAI_CODEX_CLIENT_ID");
  }

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Codex OAuth refresh failed (${res.status}): ${(await res.text()).slice(0, 500)}`,
    );
  }

  return tokenFromResponse((await res.json()) as any, refreshToken);
}

export async function fetchCodexAccountInfo(
  accessToken: string,
  config = getCodexOAuthConfig(),
): Promise<Pick<CodexTokenSet, "chatgptAccountId" | "chatgptPlanType">> {
  const res = await fetch(config.accountUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "OpenAI-Beta": "responses=experimental",
    },
  });

  if (!res.ok) {
    return {};
  }

  const data = (await res.json()) as any;
  const account = data.account || data.accounts?.[0] || data;
  return {
    chatgptAccountId:
      account.account_id ||
      account.id ||
      data.account_id ||
      data.chatgpt_account_id,
    chatgptPlanType:
      account.plan_type ||
      account.planType ||
      data.plan_type ||
      data.chatgpt_plan_type,
  };
}

export function buildCodexResponsesBody(
  input: CodexResponseInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model:
      input.model || process.env.OPENAI_CODEX_MODEL || DEFAULT_RESPONSES_MODEL,
    input: input.input,
    store: false,
    stream: true,
  };
  if (input.instructions !== undefined) body.instructions = input.instructions;
  if (input.previousResponseId !== undefined)
    body.previous_response_id = input.previousResponseId;
  if (input.metadata !== undefined) body.metadata = input.metadata;
  return body;
}

export function buildCodexResponsesHeaders(
  accessToken: string,
  accountId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "OpenAI-Beta": "responses=experimental",
    originator: "pi",
  };
  if (accountId) {
    headers["chatgpt-account-id"] = accountId;
  }
  return headers;
}

export async function postCodexResponseStream(
  accessToken: string,
  accountId: string | undefined,
  input: CodexResponseInput,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(
    process.env.OPENAI_CODEX_RESPONSES_URL || DEFAULT_CODEX_RESPONSES_URL,
    {
      method: "POST",
      headers: buildCodexResponsesHeaders(accessToken, accountId),
      body: JSON.stringify(buildCodexResponsesBody(input)),
      signal,
    },
  );
}

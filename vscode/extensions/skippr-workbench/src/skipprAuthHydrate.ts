import * as vscode from "vscode";
import { parseJwtEmail } from "./skipprJwt";
import { readSkipprCliCredentialsFile, type SkipprCliStoredCredentials } from "./skipprCliCredentials";
import { SKIPPR_ENV_SETTING } from "./skipprEnv";

export interface SkipprAuthHydrateDeps {
  authBaseUrl: string;
  apiRequest(path: string, method: string, body?: unknown, token?: string): Promise<Response>;
  tryApiRequest(path: string, method: string, body?: unknown, token?: string): Promise<Response | null>;
}

/** Same sources as skippr-cli: `SKIPPR_API_KEY` then `~/.skippr/credentials.json`. */
export function resolveSkipprApiKeyFromEnvironment(): string | undefined {
  const fromEnv = process.env.SKIPPR_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const extra = vscode.workspace.getConfiguration("skippr").get<Record<string, string>>(SKIPPR_ENV_SETTING);
  if (!extra || typeof extra !== "object") {
    return undefined;
  }
  const fromSettings = extra.SKIPPR_API_KEY?.trim();
  return fromSettings || undefined;
}

export async function exchangeApiKeyForCredentials(
  deps: SkipprAuthHydrateDeps,
  apiKey: string
): Promise<SkipprCliStoredCredentials | undefined> {
  try {
    const response = await fetch(`${deps.authBaseUrl}/auth/api-key-exchange`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      return undefined;
    }
    const data = (await response.json()) as { token?: string; refresh_token?: string };
    const access_token = data.token?.trim();
    const refresh_token = data.refresh_token?.trim();
    if (!access_token || !refresh_token) {
      return undefined;
    }
    return { access_token, refresh_token };
  } catch {
    return undefined;
  }
}

export async function loadCliCompatibleCredentials(
  deps: SkipprAuthHydrateDeps
): Promise<SkipprCliStoredCredentials | undefined> {
  const apiKey = resolveSkipprApiKeyFromEnvironment();
  if (apiKey) {
    const exchanged = await exchangeApiKeyForCredentials(deps, apiKey);
    if (exchanged) {
      return exchanged;
    }
  }
  return readSkipprCliCredentialsFile();
}

export async function credentialsAreValid(
  deps: SkipprAuthHydrateDeps,
  creds: SkipprCliStoredCredentials
): Promise<boolean> {
  const response = await deps.tryApiRequest("/account", "GET", undefined, creds.access_token);
  return Boolean(response?.ok);
}

export function authSessionFromCredentials(creds: SkipprCliStoredCredentials): {
  token: string;
  refreshToken: string;
  email: string;
} {
  return {
    token: creds.access_token,
    refreshToken: creds.refresh_token,
    email: parseJwtEmail(creds.access_token) ?? "signed-in@skippr"
  };
}

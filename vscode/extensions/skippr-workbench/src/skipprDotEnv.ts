import * as fs from "node:fs";
import * as path from "node:path";

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Minimal `.env` parsing (KEY=value, optional quotes, `export ` prefix, `#` comments).
 * Matches common cases used with Skippr `${VAR}` interpolation.
 */
export function parseDotEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return out;
  }
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    let rest = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = rest.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = rest.slice(0, eq).trim();
    if (!KEY_RE.test(key)) {
      continue;
    }
    let value = rest.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Effective env for Skippr interpolation checks: same layering as the CLI
 * (`dotenvy::from_path` for `.env`, then `from_path_override` for `.env.local`).
 */
export function effectiveEnvForSkipprConfig(configYamlFsPath: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dir = path.dirname(configYamlFsPath);
  const fromEnv = parseDotEnvFile(path.join(dir, ".env"));
  const fromLocal = parseDotEnvFile(path.join(dir, ".env.local"));
  const merged: Record<string, string | undefined> = { ...base };
  for (const [k, v] of Object.entries(fromEnv)) {
    if (v === undefined) {
      continue;
    }
    const cur = merged[k];
    if (cur === undefined || cur === "") {
      merged[k] = v;
    }
  }
  for (const [k, v] of Object.entries(fromLocal)) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }
  return merged as NodeJS.ProcessEnv;
}

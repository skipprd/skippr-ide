export const SKIPPR_BEFORE_SCHEME = "skippr-before";

export type SkipprBeforeUri = {
  scheme: typeof SKIPPR_BEFORE_SCHEME;
  path: string;
};

export function skipprBeforeUri(absolutePath: string): SkipprBeforeUri {
  const normalized = absolutePath.replace(/\\/g, "/");
  const path = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return { scheme: SKIPPR_BEFORE_SCHEME, path };
}

export function skipprAgentDiffTitle(absolutePath: string): string {
  const parts = absolutePath.split(/[/\\]/);
  const base = parts[parts.length - 1] || absolutePath;
  return `${base} (Skippr Agent)`;
}

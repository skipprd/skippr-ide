/** Split extra CLI text into argv tokens (basic quoting). Shared by extension and dbt test runner. */
export function parseShellArgs(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const c = trimmed[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur.length) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur.length) {
    out.push(cur);
  }
  return out;
}

/** Human-readable run titles and status for Run sidebar / timeline webviews. */

export interface RunDisplayLike {
  runKind?: string;
  command?: string;
  pipeline?: string;
  label?: string;
  status?: string;
  phase?: string;
}

const TERMINAL_PHASES = new Set(["complete", "completed", "success", "failed", "error", "stopped", "idle"]);

export function runKindLabel(runKind: string | undefined, command?: string): string {
  const kind = (runKind || command || "").trim().toLowerCase();
  if (kind === "discover") {
    return "Discover";
  }
  if (kind === "model" || kind.startsWith("model")) {
    return "Model";
  }
  if (kind === "sync-all-once") {
    return "Sync all";
  }
  if (kind === "sync" || kind === "sync-once" || kind.startsWith("sync")) {
    return "Sync";
  }
  if (kind === "doctor") {
    return "Doctor";
  }
  if (!kind) {
    return "Run";
  }
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function runTitle(run: RunDisplayLike): string {
  const pipeline = run.pipeline?.trim();
  const kind = runKindLabel(run.runKind, run.command);
  if (pipeline) {
    return kind + " · " + pipeline;
  }
  const label = run.label?.trim();
  if (label) {
    return label;
  }
  return kind;
}

export function runPhaseHint(run: RunDisplayLike): string {
  if (run.status !== "running") {
    return "";
  }
  const phase = (run.phase || "").trim().toLowerCase();
  if (!phase || TERMINAL_PHASES.has(phase)) {
    return "";
  }
  if (phase === "syncing") {
    return "Syncing";
  }
  if (phase === "discovering") {
    return "Discovering";
  }
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

export function isTerminalHeadlineEvent(eventName: string): boolean {
  return (
    eventName === "sync_complete" ||
    eventName === "discover_complete" ||
    eventName === "sync_error" ||
    eventName === "discover_start" ||
    eventName === "sync_start" ||
    eventName === "model_complete" ||
    eventName === "model_error" ||
    eventName === "sync_status"
  );
}

/** In-webview helpers for run title, status badge, and phase hints. */
export function buildSkipprRunDisplayScript(): string {
  return `
      function runKindLabel(runKind, command) {
        const kind = String(runKind || command || "").trim().toLowerCase();
        if (kind === "discover") { return "Discover"; }
        if (kind === "model" || kind.startsWith("model")) { return "Model"; }
        if (kind === "sync-all-once") { return "Sync all"; }
        if (kind === "sync" || kind === "sync-once" || kind.startsWith("sync")) { return "Sync"; }
        if (kind === "doctor") { return "Doctor"; }
        if (!kind) { return "Run"; }
        return kind.charAt(0).toUpperCase() + kind.slice(1);
      }
      function runTitle(run) {
        const pipeline = run && run.pipeline ? String(run.pipeline).trim() : "";
        const kind = runKindLabel(run && run.runKind, run && run.command);
        if (pipeline) { return kind + " · " + pipeline; }
        const label = run && run.label ? String(run.label).trim() : "";
        if (label) { return label; }
        return kind;
      }
      function runPhaseHint(run) {
        if (!run || run.status !== "running") { return ""; }
        const phase = String(run.phase || "").trim().toLowerCase();
        const terminal = { complete: 1, completed: 1, success: 1, failed: 1, error: 1, stopped: 1, idle: 1 };
        if (!phase || terminal[phase]) { return ""; }
        if (phase === "syncing") { return "Syncing"; }
        if (phase === "discovering") { return "Discovering"; }
        return phase.charAt(0).toUpperCase() + phase.slice(1);
      }
  `;
}

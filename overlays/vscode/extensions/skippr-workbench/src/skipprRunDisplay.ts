import { RUN_KIND_LABELS, runKindLabelFromUnknown } from "./skipprRunKinds";

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

export function runTitle(run: RunDisplayLike): string {
  const pipeline = run.pipeline?.trim();
  const kind = runKindLabelFromUnknown(run.runKind, run.command);
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
      const RUN_KIND_LABELS = ${JSON.stringify(RUN_KIND_LABELS)};
      function runKindLabel(runKind, command) {
        const kind = String(runKind || command || "").trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(RUN_KIND_LABELS, kind)) { return RUN_KIND_LABELS[kind]; }
        if (kind.startsWith("model")) { return RUN_KIND_LABELS.model; }
        if (kind.startsWith("sync") && kind !== "sync-all-once") { return RUN_KIND_LABELS["sync-once"]; }
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

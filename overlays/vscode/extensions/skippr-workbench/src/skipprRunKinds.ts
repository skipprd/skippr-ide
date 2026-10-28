import type { SkipprRunKind } from "./skipprSdeArgv";

export type SkipprRunnableKind = SkipprRunKind | "ask" | "plan" | "doctor" | "test";

export const RUN_KIND_LABELS: Record<SkipprRunnableKind, string> = {
  discover: "Discover",
  model: "Model",
  "sync-all-once": "Sync all",
  "sync-once": "Sync",
  sync: "Start Sync",
  ask: "Ask",
  plan: "Plan",
  doctor: "Doctor",
  test: "Test"
};

export function isSkipprRunnableKind(value: unknown): value is SkipprRunnableKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RUN_KIND_LABELS, value);
}

export function runKindLabel(kind: SkipprRunnableKind): string {
  return RUN_KIND_LABELS[kind];
}

export function runKindLabelFromUnknown(runKind: string | undefined, command?: string): string {
  const kind = (runKind || command || "").trim().toLowerCase();
  if (isSkipprRunnableKind(kind)) {
    return RUN_KIND_LABELS[kind];
  }
  if (kind.startsWith("model")) {
    return RUN_KIND_LABELS.model;
  }
  if (kind.startsWith("sync") && kind !== "sync-all-once") {
    return RUN_KIND_LABELS["sync-once"];
  }
  if (!kind) {
    return "Run";
  }
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

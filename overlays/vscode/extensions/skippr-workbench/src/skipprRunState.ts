import * as crypto from "node:crypto";
import * as vscode from "vscode";
import {
  SkipprAffectedAsset,
  SkipprDeadletterSummary,
  SkipprFreshness,
  SkipprModelChangedFile,
  SkipprModelFileSummary,
  SkipprModelPreflight,
  SkipprModelValidation,
  SkipprRunEvent,
  SkipprRunMetrics,
  SkipprRunSchemaSnapshot,
  SkipprSchemaDiffPayload
} from "./types";

const MAX_RETAINED_RUN_EVENTS = 400;

export type SkipprObservedRunStatus = "running" | "success" | "error" | "stopped";

export interface SkipprMetricPoint extends SkipprRunMetrics {
  timestamp: string;
}

export interface SkipprSchemaChange {
  namespace: string;
  diff: SkipprSchemaDiffPayload;
  schema?: SkipprRunSchemaSnapshot;
  timestamp: string;
}

export interface SkipprObservedRun {
  id: string;
  command: string;
  runKind: string;
  label: string;
  pipeline?: string;
  configPath?: string;
  status: SkipprObservedRunStatus;
  phase?: string;
  startedAt: number;
  finishedAt?: number;
  elapsedMs?: number;
  exitCode?: number | null;
  signal?: string | null;
  headline: string;
  detail?: string;
  totalRows?: number;
  rowsWritten?: number;
  bytesTotal?: number;
  latestMetrics?: SkipprRunMetrics;
  modelPreflight?: SkipprModelPreflight;
  modelChangedFiles: SkipprModelChangedFile[];
  modelFileSummary: SkipprModelFileSummary;
  modelValidation?: SkipprModelValidation;
  modelThreadId?: string;
  modelRepairStatus?: string;
  modelPendingPlanRevision?: boolean;
  modelReviewUri?: string;
  metricPoints: SkipprMetricPoint[];
  freshness?: SkipprFreshness;
  deadletters?: SkipprDeadletterSummary;
  affectedAssets: SkipprAffectedAsset[];
  schemas: Record<string, SkipprRunSchemaSnapshot>;
  schemaChanges: SkipprSchemaChange[];
  events: SkipprRunEvent[];
}

export interface SkipprRunHistorySummary {
  id: string;
  command: string;
  runKind: string;
  label: string;
  pipeline?: string;
  status: SkipprObservedRunStatus;
  startedAt: number;
  finishedAt?: number;
  elapsedMs?: number;
  totalRows?: number;
  freshnessIso?: string;
  deadlettersTotal?: number;
}

export interface SkipprRunStateSnapshot {
  type: "observability";
  current?: SkipprObservedRun;
  selected?: SkipprObservedRun;
  history: SkipprRunHistorySummary[];
}

export class SkipprRunStateStore {
  private readonly emitter = new vscode.EventEmitter<SkipprRunStateSnapshot>();
  private currentRun: SkipprObservedRun | undefined;
  private selectedRun: SkipprObservedRun | undefined;
  private history: SkipprRunHistorySummary[] = [];

  readonly onDidChange = this.emitter.event;

  dispose(): void {
    this.emitter.dispose();
  }

  snapshot(): SkipprRunStateSnapshot {
    return {
      type: "observability",
      current: this.currentRun,
      selected: this.selectedRun,
      history: this.history
    };
  }

  setHistory(history: SkipprRunHistorySummary[]): void {
    this.history = history;
    this.emit();
  }

  selectRun(run: SkipprObservedRun | undefined): void {
    this.selectedRun = run;
    this.emit();
  }

  startRun(opts: {
    command: string;
    label: string;
    pipeline?: string;
    configPath?: string;
  }): SkipprObservedRun {
    const now = Date.now();
    this.currentRun = {
      id: crypto.randomUUID(),
      command: opts.command,
      runKind: opts.command,
      label: opts.label,
      pipeline: opts.pipeline,
      configPath: opts.configPath,
      status: "running",
      startedAt: now,
      headline: opts.label,
      modelChangedFiles: [],
      modelFileSummary: {},
      metricPoints: [],
      affectedAssets: [],
      schemas: {},
      schemaChanges: [],
      events: []
    };
    this.selectedRun = this.currentRun;
    this.emit();
    return this.currentRun;
  }

  recordEvent(event: SkipprRunEvent): SkipprObservedRun | undefined {
    if (!this.currentRun) {
      return undefined;
    }

    const wasFollowingCurrent =
      !this.selectedRun ||
      this.selectedRun === this.currentRun ||
      this.selectedRun.id === this.currentRun.id;

    if (event.run_id?.trim()) {
      this.currentRun.id = event.run_id.trim();
    }
    appendRetainedEvent(this.currentRun.events, event);
    this.currentRun.pipeline = event.pipeline ?? this.currentRun.pipeline;
    this.currentRun.phase = event.phase ?? this.currentRun.phase;
    this.currentRun.headline = describeRunEvent(event) ?? this.currentRun.headline;
    this.currentRun.totalRows = event.total_rows ?? event.metrics?.messages_total ?? this.currentRun.totalRows;
    this.currentRun.rowsWritten = event.rows_written ?? event.metrics?.rows_written ?? this.currentRun.rowsWritten;
    this.currentRun.bytesTotal = event.bytes ?? event.metrics?.bytes_total ?? this.currentRun.bytesTotal;
    this.currentRun.latestMetrics = event.metrics ?? event.metric_points ?? this.currentRun.latestMetrics;
    this.currentRun.runKind = normalizeRunKind(
      event.run_kind ?? runKindFromEvent(event) ?? this.currentRun.runKind,
      this.currentRun.command
    );
    this.currentRun.modelThreadId = event.thread_id ?? this.currentRun.modelThreadId;
    this.currentRun.modelRepairStatus = event.repair_status ?? this.currentRun.modelRepairStatus;
    this.currentRun.modelPendingPlanRevision = event.pending_plan_revision ?? this.currentRun.modelPendingPlanRevision;
    this.currentRun.modelReviewUri = event.review_uri ?? this.currentRun.modelReviewUri;
    this.currentRun.modelPreflight = event.model_preflight ?? this.currentRun.modelPreflight;
    this.currentRun.modelValidation = event.validation ?? this.currentRun.modelValidation;
    this.currentRun.modelValidation = validationFromToolEvent(event) ?? this.currentRun.modelValidation;
    if (event.changed_files?.length) {
      this.currentRun.modelChangedFiles.push(...event.changed_files);
    }
    this.currentRun.modelFileSummary = mergeModelFileSummary(
      this.currentRun.modelFileSummary,
      this.currentRun.modelChangedFiles,
      event
    );
    this.currentRun.freshness = event.freshness ?? this.currentRun.freshness;
    this.currentRun.deadletters = event.deadletters ?? this.currentRun.deadletters;
    this.currentRun.affectedAssets = event.affected_assets ?? this.currentRun.affectedAssets;

    if (event.metrics || event.metric_points) {
      this.currentRun.metricPoints.push({
        ...(event.metric_points ?? event.metrics),
        deadletters_total: event.deadletters?.total,
        timestamp: event.timestamp ?? new Date().toISOString()
      });
    }
    if (event.schema?.namespace) {
      this.currentRun.schemas[event.schema.namespace] = event.schema;
    }
    if (event.schema_diff && event.namespace) {
      this.currentRun.schemaChanges.push({
        namespace: event.namespace,
        diff: event.schema_diff,
        schema: event.schema,
        timestamp: event.timestamp ?? new Date().toISOString()
      });
    }
    if (event.event === "sync_complete" || event.event === "discover_complete") {
      this.currentRun.finishedAt = Date.now();
      this.currentRun.elapsedMs = event.elapsed_ms ?? this.currentRun.finishedAt - this.currentRun.startedAt;
    }
    if (event.event === "model_complete" || event.event === "model_error") {
      this.currentRun.finishedAt = Date.now();
      this.currentRun.elapsedMs = event.elapsed_ms ?? this.currentRun.finishedAt - this.currentRun.startedAt;
    }

    if (wasFollowingCurrent) {
      this.selectedRun = this.currentRun;
    }
    this.emit();
    return this.currentRun;
  }

  finishRun(outcome: {
    status: SkipprObservedRunStatus;
    exitCode?: number | null;
    signal?: string | null;
    elapsedMs?: number;
    detail?: string;
  }): SkipprObservedRun | undefined {
    if (!this.currentRun) {
      return undefined;
    }
    this.currentRun.status = outcome.status;
    this.currentRun.exitCode = outcome.exitCode;
    this.currentRun.signal = outcome.signal;
    this.currentRun.elapsedMs = outcome.elapsedMs ?? Date.now() - this.currentRun.startedAt;
    this.currentRun.finishedAt = Date.now();
    this.currentRun.detail = outcome.detail ?? this.currentRun.detail;
    const finished = this.currentRun;
    this.selectedRun = finished;
    this.currentRun = undefined;
    this.emit();
    return finished;
  }

  private emit(): void {
    this.emitter.fire(this.snapshot());
  }
}

export function summarizeRun(run: SkipprObservedRun): SkipprRunHistorySummary {
  return {
    id: run.id,
    command: run.command,
    runKind: run.runKind,
    label: run.label,
    pipeline: run.pipeline,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    elapsedMs: run.elapsedMs,
    totalRows: run.totalRows,
    freshnessIso: run.freshness?.latest_iso ?? undefined,
    deadlettersTotal: run.deadletters?.total
  };
}

function mergeModelFileSummary(
  current: SkipprModelFileSummary,
  files: SkipprModelChangedFile[],
  event: SkipprRunEvent
): SkipprModelFileSummary {
  const derived = summarizeModelFiles(files);
  const hasChangedFiles = Boolean(event.changed_files?.length);
  return {
    ...current,
    ...derived,
    total_count: event.total_count ?? (hasChangedFiles ? derived.total_count : current.total_count ?? derived.total_count),
    created_count: event.created_count ?? (hasChangedFiles ? derived.created_count : current.created_count ?? derived.created_count),
    modified_count: event.modified_count ?? (hasChangedFiles ? derived.modified_count : current.modified_count ?? derived.modified_count),
    deleted_count: event.deleted_count ?? (hasChangedFiles ? derived.deleted_count : current.deleted_count ?? derived.deleted_count),
    lines_added: event.lines_added ?? (hasChangedFiles ? derived.lines_added : current.lines_added ?? derived.lines_added),
    lines_removed: event.lines_removed ?? (hasChangedFiles ? derived.lines_removed : current.lines_removed ?? derived.lines_removed),
    review_uri: event.review_uri ?? current.review_uri,
    summary: event.summary ?? current.summary
  };
}

function summarizeModelFiles(files: SkipprModelChangedFile[]): SkipprModelFileSummary {
  const summary: Required<Pick<SkipprModelFileSummary, "total_count" | "created_count" | "modified_count" | "deleted_count" | "lines_added" | "lines_removed">> = {
    total_count: 0,
    created_count: 0,
    modified_count: 0,
    deleted_count: 0,
    lines_added: 0,
    lines_removed: 0
  };
  for (const file of files) {
    summary.total_count++;
    if (file.change_kind === "created") {
      summary.created_count++;
    } else if (file.change_kind === "deleted") {
      summary.deleted_count++;
    } else {
      summary.modified_count++;
    }
    summary.lines_added += file.lines_added ?? 0;
    summary.lines_removed += file.lines_removed ?? 0;
  }
  return summary;
}

function runKindFromEvent(event: SkipprRunEvent): string | undefined {
  if (event.event === "tool_start" || event.event === "tool_end") {
    return "model";
  }
  if (event.event.startsWith("model_")) {
    return event.run_kind ?? "model";
  }
  if (event.event.startsWith("sync_") || event.event === "batch_ingested" || event.event === "output_synced") {
    return "sync";
  }
  if (event.event.startsWith("discover_") || event.event === "namespace_discovered" || event.event === "schema_evolved") {
    return "discover";
  }
  return undefined;
}

function normalizeRunKind(kind: string | undefined, command: string): string {
  const raw = kind?.trim() || command;
  if (command === "model" && (raw === "agent" || raw === "model")) {
    return "model";
  }
  return raw;
}

function validationFromToolEvent(event: SkipprRunEvent): SkipprModelValidation | undefined {
  if (event.event !== "tool_end" || event.name !== "dbt_validate") {
    return undefined;
  }
  return {
    ok: event.status === "ok",
    stage: "dbt_validate",
    message: event.error ?? (event.status === "ok" ? "dbt validation passed" : "dbt validation failed"),
    errors: event.error ? [event.error] : undefined,
    finished_at: event.timestamp
  };
}

function appendRetainedEvent(events: SkipprRunEvent[], event: SkipprRunEvent): void {
  if (!shouldRetainEvent(event)) {
    return;
  }
  const last = events[events.length - 1];
  if (last && equivalentTimelineEvent(last, event)) {
    events[events.length - 1] = event;
  } else {
    events.push(event);
  }
  if (events.length > MAX_RETAINED_RUN_EVENTS) {
    events.splice(0, events.length - MAX_RETAINED_RUN_EVENTS);
  }
}

function shouldRetainEvent(event: SkipprRunEvent): boolean {
  if (event.event === "tool_start") {
    return false;
  }
  if (event.event === "tool_end") {
    return event.status !== "ok" && event.status !== "success";
  }
  return true;
}

function equivalentTimelineEvent(a: SkipprRunEvent, b: SkipprRunEvent): boolean {
  return (
    a.event === b.event &&
    a.phase === b.phase &&
    a.name === b.name &&
    a.clean_name === b.clean_name &&
    a.status === b.status &&
    a.error === b.error
  );
}

function describeRunEvent(event: SkipprRunEvent): string | undefined {
  switch (event.event) {
    case "discover_start":
      return `Discover started: ${event.pipeline ?? "pipeline"}`;
    case "namespace_discovered":
      return `Discovered ${event.namespace ?? event.schema?.namespace ?? "namespace"}`;
    case "schema_evolved":
      return `Schema evolved: ${event.namespace ?? "namespace"}`;
    case "discover_complete":
      return `Discover complete: ${event.pipeline ?? "pipeline"}`;
    case "sync_start":
      return `Sync started: ${event.pipeline ?? "pipeline"}`;
    case "sync_status":
      return `Sync status: rows=${event.total_rows ?? event.metrics?.messages_total ?? 0}`;
    case "batch_ingested":
      return `Batch ingested: ${event.namespace ?? "namespace"}`;
    case "output_synced":
      return `Output synced: ${event.namespace ?? "namespace"}`;
    case "sync_complete":
      return `Sync complete: ${event.pipeline ?? "pipeline"}`;
    case "sync_error":
      return `Sync error: ${event.error ?? "unknown error"}`;
    case "tool_start":
      return undefined;
    case "tool_end":
      if (event.status === "ok" || event.status === "success") {
        return undefined;
      }
      return `Tool ${event.status ?? "finished"}: ${event.clean_name ?? event.name ?? "tool"}`;
    case "model_start":
      return `Model started: ${event.pipeline ?? "pipeline"}`;
    case "model_preflight":
      return event.model_preflight?.ok
        ? `Model preflight passed: ${event.model_preflight.command ?? "dbt"}`
        : `Model preflight failed`;
    case "model_authoring_start":
      return "Model authoring started";
    case "model_file_changed":
      return `Model files changed: ${event.changed_files?.length ?? 0}`;
    case "model_review_ready":
      return event.summary ?? `Model review ready: ${event.total_count ?? event.changed_files?.length ?? 0} files`;
    case "model_validation_start":
      return "Model validation started";
    case "model_validation":
      return event.validation?.ok ? "Model validation passed" : "Model validation failed";
    case "model_validation_complete":
      return event.validation?.ok ? "Model validation passed" : "Model validation failed";
    case "model_phase_changed":
      return `Model phase: ${event.phase ?? "unknown"}`;
    case "model_complete":
      return `Model complete: ${event.pipeline ?? "pipeline"}`;
    case "model_error":
      return `Model error: ${event.error ?? event.failure_summary ?? "unknown error"}`;
    default:
      return undefined;
  }
}

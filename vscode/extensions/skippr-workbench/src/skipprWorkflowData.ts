import type { SkipprLineagePanelPayload } from "./skipprLineagePanelHtml";
import type { SkipprObservedRun, SkipprRunHistorySummary, SkipprRunStateSnapshot } from "./skipprRunState";
import type { SkipprConfigShowResult, SkipprRunSchemaSnapshot } from "./types";

export type SkipprWorkflowKind = "discover" | "sync" | "model";

export type SkipprWorkflowPanelStatus = "idle" | "loading" | "ready" | "error";

export interface SkipprWorkflowRunCard {
  id: string;
  command: string;
  runKind: string;
  label: string;
  pipeline?: string;
  status: string;
  phase?: string;
  headline: string;
  detail?: string;
  startedAt: number;
  finishedAt?: number;
  elapsedMs?: number;
  totalRows?: number;
  rowsWritten?: number;
  bytesTotal?: number;
  namespaceCount?: number;
  deadlettersTotal?: number;
  freshnessIso?: string;
  modelChangedCount?: number;
  modelValidationOk?: boolean;
}

export interface SkipprWorkflowNamespaceRow {
  namespace: string;
  fieldCount: number;
}

export interface SkipprWorkflowSchemaChangeRow {
  timestamp: string;
  namespace: string;
  summary: string;
}

export interface SkipprWorkflowBasePayload {
  type: "discoverWorkflow" | "syncWorkflow" | "catalogWorkflow" | "modelWorkflow";
  status: SkipprWorkflowPanelStatus;
  configPath?: string;
  workspace?: string;
  pipelines: string[];
  selectedPipeline?: string;
  error?: string;
  latestRun?: SkipprWorkflowRunCard;
  recentRuns?: SkipprWorkflowRunCard[];
}

export interface SkipprDiscoverWorkflowPayload extends SkipprWorkflowBasePayload {
  type: "discoverWorkflow";
  namespaces: SkipprWorkflowNamespaceRow[];
  schemaChanges: SkipprWorkflowSchemaChangeRow[];
}

export interface SkipprSyncWorkflowPayload extends SkipprWorkflowBasePayload {
  type: "syncWorkflow";
  metricPoints: Array<{ timestamp: string; rows_written?: number; bytes_total?: number }>;
  hasDeadletters: boolean;
}

export interface SkipprCatalogNodeRow {
  id: string;
  label: string;
  kind: string;
  datasetId?: string;
  path?: string;
  fieldCount: number;
  fields: Array<{ name: string; fieldType?: string }>;
}

export interface SkipprCatalogWorkflowPayload extends SkipprWorkflowBasePayload {
  type: "catalogWorkflow";
  lineageStatus: "idle" | "loading" | "ready" | "error";
  lineageError?: string;
  nodes: SkipprCatalogNodeRow[];
  selectedNodeId?: string;
}

export interface SkipprModelWorkflowPayload extends SkipprWorkflowBasePayload {
  type: "modelWorkflow";
}

export type SkipprWorkflowWebviewPayload =
  | SkipprDiscoverWorkflowPayload
  | SkipprSyncWorkflowPayload
  | SkipprCatalogWorkflowPayload
  | SkipprModelWorkflowPayload;

export const CATALOG_LINEAGE_NODE_KINDS = new Set([
  "WarehouseTable",
  "DbtModel",
  "DbtSource",
  "IngestTable",
  "Metric",
  "RawSource"
]);

const SYNC_RUN_KINDS = new Set(["sync", "sync-once", "sync-all-once"]);

export function matchesWorkflowKind(
  run: { runKind: string; command: string },
  kind: SkipprWorkflowKind
): boolean {
  const runKind = (run.runKind || "").trim();
  const command = (run.command || "").trim();
  switch (kind) {
    case "discover":
      return runKind === "discover" || command === "discover";
    case "sync":
      return SYNC_RUN_KINDS.has(runKind) || SYNC_RUN_KINDS.has(command);
    case "model":
      return runKind === "model" || command === "model" || runKind === "agent";
    default:
      return false;
  }
}

export function pipelineMatchesRun(run: { pipeline?: string }, pipeline: string): boolean {
  const runPipeline = run.pipeline?.trim();
  const selected = pipeline.trim();
  if (!selected) {
    return true;
  }
  if (!runPipeline) {
    return true;
  }
  return runPipeline === selected;
}

export function latestRunForPipeline(
  kind: SkipprWorkflowKind,
  pipeline: string,
  snapshot: SkipprRunStateSnapshot
): SkipprObservedRun | SkipprRunHistorySummary | undefined {
  const candidates: Array<SkipprObservedRun | SkipprRunHistorySummary> = [];
  if (snapshot.current && matchesWorkflowKind(snapshot.current, kind) && pipelineMatchesRun(snapshot.current, pipeline)) {
    candidates.push(snapshot.current);
  }
  if (
    snapshot.selected &&
    snapshot.selected.id !== snapshot.current?.id &&
    matchesWorkflowKind(snapshot.selected, kind) &&
    pipelineMatchesRun(snapshot.selected, pipeline)
  ) {
    candidates.push(snapshot.selected);
  }
  for (const summary of snapshot.history) {
    if (matchesWorkflowKind(summary, kind) && pipelineMatchesRun(summary, pipeline)) {
      candidates.push(summary);
    }
  }
  candidates.sort((a, b) => b.startedAt - a.startedAt);
  return candidates[0];
}

export function runsForPipeline(
  kind: SkipprWorkflowKind,
  pipeline: string,
  snapshot: SkipprRunStateSnapshot,
  limit = 8
): Array<SkipprObservedRun | SkipprRunHistorySummary> {
  const seen = new Set<string>();
  const rows: Array<SkipprObservedRun | SkipprRunHistorySummary> = [];
  const push = (run: SkipprObservedRun | SkipprRunHistorySummary | undefined): void => {
    if (!run || !matchesWorkflowKind(run, kind) || !pipelineMatchesRun(run, pipeline) || seen.has(run.id)) {
      return;
    }
    seen.add(run.id);
    rows.push(run);
  };
  push(snapshot.current);
  push(snapshot.selected);
  for (const summary of snapshot.history) {
    push(summary);
  }
  return rows.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export function schemasFromRun(run: SkipprObservedRun | undefined): SkipprWorkflowNamespaceRow[] {
  if (!run?.schemas) {
    return [];
  }
  return Object.entries(run.schemas)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, schema]) => ({
      namespace,
      fieldCount: Array.isArray(schema.fields) ? schema.fields.length : 0
    }));
}

export function schemaChangesFromRun(run: SkipprObservedRun | undefined): SkipprWorkflowSchemaChangeRow[] {
  if (!run?.schemaChanges?.length) {
    return [];
  }
  return run.schemaChanges.slice(0, 12).map((change) => ({
    timestamp: change.timestamp,
    namespace: change.namespace,
    summary: summarizeSchemaDiff(change.diff)
  }));
}

export function catalogNodesFromGraph(graph: SkipprLineagePanelPayload["graph"] | undefined): SkipprCatalogNodeRow[] {
  const nodes = graph?.nodes ?? [];
  const fieldNodes = nodes.filter((node) => node.kind === "Field" || node.field?.field_path);
  const fieldsByDataset = new Map<string, Array<{ name: string; fieldType?: string }>>();
  for (const node of fieldNodes) {
    const datasetId = node.field?.dataset_id || node.dataset_id;
    if (!datasetId) {
      continue;
    }
    const name = node.field?.field_path || node.label;
    if (!name) {
      continue;
    }
    const bucket = fieldsByDataset.get(datasetId) ?? [];
    bucket.push({ name, fieldType: node.metadata?.data_type });
    fieldsByDataset.set(datasetId, bucket);
  }
  return nodes
    .filter((node) => CATALOG_LINEAGE_NODE_KINDS.has(node.kind))
    .map((node) => {
      const datasetId = node.dataset_id || node.id;
      const fields = fieldsByDataset.get(datasetId) ?? [];
      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        datasetId: node.dataset_id,
        path: node.path || node.metadata?.path,
        fieldCount: fields.length,
        fields: fields.slice(0, 24)
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function summarizeSchemaDiff(diff: { added?: string[]; removed?: string[]; changed?: Array<{ name?: string }> }): string {
  const added = diff.added?.length ?? 0;
  const removed = diff.removed?.length ?? 0;
  const changed = diff.changed?.length ?? 0;
  const parts: string[] = [];
  if (added) {
    parts.push(`+${added} fields`);
  }
  if (removed) {
    parts.push(`-${removed} fields`);
  }
  if (changed) {
    parts.push(`${changed} changed`);
  }
  return parts.length ? parts.join(", ") : "schema change";
}

function toRunCard(run: SkipprObservedRun | SkipprRunHistorySummary): SkipprWorkflowRunCard {
  const observed = run as SkipprObservedRun;
  const summary = run as SkipprRunHistorySummary;
  const namespaceCount = observed.schemas ? Object.keys(observed.schemas).length : undefined;
  return {
    id: run.id,
    command: run.command,
    runKind: run.runKind,
    label: run.label,
    pipeline: run.pipeline,
    status: run.status,
    phase: observed.phase,
    headline: observed.headline ?? run.label,
    detail: observed.detail,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    elapsedMs: run.elapsedMs,
    totalRows: summary.totalRows ?? observed.totalRows,
    rowsWritten: observed.rowsWritten,
    bytesTotal: observed.bytesTotal,
    namespaceCount,
    deadlettersTotal: summary.deadlettersTotal ?? observed.deadletters?.total,
    freshnessIso: summary.freshnessIso ?? observed.freshness?.latest_iso ?? undefined,
    modelChangedCount: observed.modelChangedFiles?.length ?? observed.modelFileSummary?.total_count,
    modelValidationOk: observed.modelValidation?.ok
  };
}

function basePayload(
  type: SkipprWorkflowBasePayload["type"],
  options: {
    status: SkipprWorkflowPanelStatus;
    show?: SkipprConfigShowResult;
    selectedPipeline?: string;
    error?: string;
    snapshot: SkipprRunStateSnapshot;
    kind: SkipprWorkflowKind;
    run?: SkipprObservedRun;
  }
): SkipprWorkflowBasePayload {
  const pipeline = options.selectedPipeline?.trim() || "";
  const latest = pipeline
    ? latestRunForPipeline(options.kind, pipeline, options.snapshot)
    : undefined;
  const latestRun = options.run
    ? toRunCard(options.run)
    : latest
      ? toRunCard(latest as SkipprObservedRun | SkipprRunHistorySummary)
      : undefined;
  const recentRuns = pipeline
    ? runsForPipeline(options.kind, pipeline, options.snapshot).map((row) => toRunCard(row))
    : [];
  return {
    type,
    status: options.status,
    configPath: options.show?.config_path,
    workspace: options.show?.workspace,
    pipelines: options.show?.pipelines ?? [],
    selectedPipeline: pipeline || undefined,
    error: options.error,
    latestRun,
    recentRuns
  };
}

export function buildDiscoverPayload(options: {
  status: SkipprWorkflowPanelStatus;
  show?: SkipprConfigShowResult;
  selectedPipeline?: string;
  error?: string;
  snapshot: SkipprRunStateSnapshot;
  run?: SkipprObservedRun;
}): SkipprDiscoverWorkflowPayload {
  const pipeline = options.selectedPipeline?.trim() || "";
  const latest = options.run ?? (pipeline ? (latestRunForPipeline("discover", pipeline, options.snapshot) as SkipprObservedRun | undefined) : undefined);
  const fullRun = latest && "schemas" in latest ? latest : options.run;
  return {
    ...basePayload("discoverWorkflow", { ...options, kind: "discover", run: fullRun }),
    type: "discoverWorkflow",
    namespaces: schemasFromRun(fullRun),
    schemaChanges: schemaChangesFromRun(fullRun)
  };
}

export function buildSyncPayload(options: {
  status: SkipprWorkflowPanelStatus;
  show?: SkipprConfigShowResult;
  selectedPipeline?: string;
  error?: string;
  snapshot: SkipprRunStateSnapshot;
  run?: SkipprObservedRun;
}): SkipprSyncWorkflowPayload {
  const pipeline = options.selectedPipeline?.trim() || "";
  const latest = options.run ?? (pipeline ? (latestRunForPipeline("sync", pipeline, options.snapshot) as SkipprObservedRun | undefined) : undefined);
  const fullRun = latest && "metricPoints" in latest ? latest : options.run;
  return {
    ...basePayload("syncWorkflow", { ...options, kind: "sync", run: fullRun }),
    type: "syncWorkflow",
    metricPoints: (fullRun?.metricPoints ?? []).slice(-24).map((point) => ({
      timestamp: point.timestamp,
      rows_written: point.rows_written,
      bytes_total: point.bytes_total
    })),
    hasDeadletters: Boolean(fullRun?.deadletters?.total)
  };
}

export function buildModelPayload(options: {
  status: SkipprWorkflowPanelStatus;
  show?: SkipprConfigShowResult;
  selectedPipeline?: string;
  error?: string;
  snapshot: SkipprRunStateSnapshot;
  run?: SkipprObservedRun;
}): SkipprModelWorkflowPayload {
  const pipeline = options.selectedPipeline?.trim() || "";
  const latest = options.run ?? (pipeline ? (latestRunForPipeline("model", pipeline, options.snapshot) as SkipprObservedRun | undefined) : undefined);
  return {
    ...basePayload("modelWorkflow", { ...options, kind: "model", run: latest }),
    type: "modelWorkflow"
  };
}

export function buildCatalogPayload(options: {
  status: SkipprWorkflowPanelStatus;
  show?: SkipprConfigShowResult;
  selectedPipeline?: string;
  error?: string;
  snapshot: SkipprRunStateSnapshot;
  lineageStatus?: SkipprCatalogWorkflowPayload["lineageStatus"];
  lineageError?: string;
  graph?: SkipprLineagePanelPayload["graph"];
  selectedNodeId?: string;
}): SkipprCatalogWorkflowPayload {
  const pipeline = options.selectedPipeline?.trim() || "";
  return {
    type: "catalogWorkflow",
    status: options.status,
    configPath: options.show?.config_path,
    workspace: options.show?.workspace,
    pipelines: options.show?.pipelines ?? [],
    selectedPipeline: pipeline || undefined,
    error: options.error,
    lineageStatus: options.lineageStatus ?? "idle",
    lineageError: options.lineageError,
    nodes: catalogNodesFromGraph(options.graph),
    selectedNodeId: options.selectedNodeId
  };
}

export function resolveDefaultPipeline(show: SkipprConfigShowResult | undefined, configuredDefault: string): string {
  const pipelines = show?.pipelines ?? [];
  const def = configuredDefault.trim();
  if (def && pipelines.includes(def)) {
    return def;
  }
  if (pipelines.length === 1) {
    return pipelines[0];
  }
  return pipelines[0] ?? "";
}

export function namespaceFieldRows(schema: SkipprRunSchemaSnapshot | undefined): Array<{
  name: string;
  fieldType: string;
  nullable: string;
}> {
  const fields = schema?.fields ?? [];
  return fields.map((field) => ({
    name: field.name ?? "unknown",
    fieldType: field.field_type ?? "unknown",
    nullable: field.nullable === false ? "required" : "nullable"
  }));
}

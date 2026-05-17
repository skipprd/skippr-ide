export type SkipprPanelId =
  | "skippr.discover"
  | "skippr.sync"
  | "skippr.model"
  | "skippr.catalog"
  | "skippr.lineage";

export type SkipprPanelName = "Discover" | "Sync" | "Model" | "Catalog" | "Lineage";

export interface ConnectionSettings {
  workspacePath: string;
  apiTarget?: string;
}

export interface ResourceNode {
  id: string;
  label: string;
  kind: "source" | "pipeline" | "model" | "table";
  path: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  owner: string;
  tags: string[];
  updatedAt: string;
}

export interface SchemaDiff {
  model: string;
  before: string[];
  after: string[];
}

export interface LineageGraph {
  nodes: Array<{ id: string; label: string; type: "source" | "model" | "table" }>;
  edges: Array<{ from: string; to: string }>;
}

export interface SkipprPanelPayload {
  panelId: SkipprPanelId;
  panelName: SkipprPanelName;
  resources: ResourceNode[];
  catalog: CatalogEntry[];
  diff: SchemaDiff;
  lineage: LineageGraph;
  diagnostics: string[];
  settings: ConnectionSettings;
}

export type SkipprRunEventName =
  | "discover_start"
  | "namespace_discovered"
  | "schema_evolved"
  | "discover_complete"
  | "sync_start"
  | "sync_status"
  | "batch_ingested"
  | "compaction_complete"
  | "output_synced"
  | "sync_complete"
  | "sync_error"
  | "tool_start"
  | "tool_end"
  | "model_start"
  | "model_thread_resumed"
  | "model_preflight"
  | "model_authoring_start"
  | "model_file_changed"
  | "model_review_ready"
  | "model_validation_start"
  | "model_validation"
  | "model_validation_complete"
  | "model_phase_changed"
  | "model_complete"
  | "model_error"
  | "ask_start"
  | "ask_complete"
  | "ask_error"
  | "plan_start"
  | "plan_complete"
  | "plan_error";

export interface SkipprRunEvent {
  event: SkipprRunEventName;
  event_kind?: string;
  step_idx?: number;
  tool_id?: string;
  name?: string;
  clean_name?: string;
  status?: string;
  run_kind?: string;
  run_id?: string;
  timestamp?: string;
  pipeline?: string;
  namespace?: string;
  field_count?: number;
  fields_added?: string[];
  rows?: number;
  bytes?: number;
  rows_written?: number;
  parquet_file?: string;
  namespaces_synced?: number;
  namespaces_discovered?: number;
  total_fields?: number;
  total_rows?: number;
  elapsed_ms?: number;
  error?: string;
  uploads_in_flight?: number;
  ok?: boolean;
  thread_id?: string;
  phase?: string;
  repair_status?: string;
  pending_plan_revision?: boolean;
  failure_summary?: string;
  answer?: string;
  plan?: string;
  summary?: string;
  review_uri?: string;
  created_count?: number;
  modified_count?: number;
  deleted_count?: number;
  total_count?: number;
  lines_added?: number;
  lines_removed?: number;
  validation_started_at?: string;
  validation_finished_at?: string;
  model_preflight?: SkipprModelPreflight;
  changed_files?: SkipprModelChangedFile[];
  validation?: SkipprModelValidation;
  metrics?: SkipprRunMetrics;
  metric_points?: SkipprRunMetrics;
  schema?: SkipprRunSchemaSnapshot;
  schema_diff?: SkipprSchemaDiffPayload;
  freshness?: SkipprFreshness;
  deadletters?: SkipprDeadletterSummary;
  affected_assets?: SkipprAffectedAsset[];
}

export interface SkipprModelPreflight {
  ok?: boolean;
  runner?: string;
  command?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
  remediation?: string;
  [key: string]: unknown;
}

export interface SkipprModelChangedFile {
  path?: string;
  absolute_path?: string;
  change_kind?: "created" | "modified" | "deleted";
  lines_added?: number;
  lines_removed?: number;
  [key: string]: unknown;
}

export interface SkipprModelFileSummary {
  total_count?: number;
  created_count?: number;
  modified_count?: number;
  deleted_count?: number;
  lines_added?: number;
  lines_removed?: number;
  review_uri?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface SkipprModelValidation {
  ok?: boolean;
  stage?: string;
  message?: string;
  errors?: string[];
  started_at?: string;
  finished_at?: string;
  elapsed_ms?: number;
  [key: string]: unknown;
}

export interface SkipprRunMetrics {
  messages_total?: number;
  bytes_total?: number;
  rows_written?: number;
  uploads_in_flight?: number;
  elapsed_ms?: number;
  namespaces_discovered?: number;
  total_fields?: number;
  wal_write_rows_total?: number;
  wal_compacted_rows_total?: number;
  parquet_persisted_rows_total?: number;
  parquet_persisted_bytes_total?: number;
  [key: string]: unknown;
}

export interface SkipprRunSchemaField {
  name: string;
  field_type?: string;
  nullable?: boolean;
  source_name?: string;
  destination_name?: string;
}

export interface SkipprRunSchemaSnapshot {
  namespace?: string;
  fields?: SkipprRunSchemaField[];
  [key: string]: unknown;
}

export interface SkipprSchemaFieldChange {
  name?: string;
  before?: SkipprRunSchemaField;
  after?: SkipprRunSchemaField;
}

export interface SkipprSchemaDiffPayload {
  added?: string[];
  removed?: string[];
  changed?: SkipprSchemaFieldChange[];
  [key: string]: unknown;
}

export interface SkipprFreshness {
  field_names?: string[];
  latest_timestamp?: number;
  latest_iso?: string | null;
  lag_seconds?: number | null;
  [key: string]: unknown;
}

export interface SkipprDeadletterSummary {
  configured?: boolean;
  total?: number;
  current?: number;
  samples?: unknown[];
  [key: string]: unknown;
}

export interface SkipprAffectedAsset {
  kind?: string;
  name?: string;
  status?: string;
  source?: string;
  [key: string]: unknown;
}

export interface SkipprDoctorCheck {
  ok: boolean;
  severity: string;
  message: string;
  suggested_fix_command?: string;
}

export interface SkipprDoctorResult {
  ok: boolean;
  config_path?: string;
  checks: SkipprDoctorCheck[];
}

export interface SkipprConfigShowResult {
  ok: boolean;
  config_path: string;
  workspace?: string;
  pipelines: string[];
  sources: string[];
  sinks: string[];
  schema_sinks: string[];
  default_pipeline?: string;
}

export interface SkipprFieldSchema {
  name: string;
  label: string;
  field_type: string;
  required: boolean;
  secret: boolean;
  repeatable: boolean;
  description: string;
  example?: string;
}

export interface SkipprConnectorSchema {
  kind: string;
  label: string;
  fields: SkipprFieldSchema[];
}

export interface SkipprConfigSchema {
  version: number;
  default_config_file: string;
  sources: SkipprConnectorSchema[];
  warehouses: SkipprConnectorSchema[];
}

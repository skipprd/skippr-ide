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
  | "discover_complete"
  | "sync_start"
  | "sync_status"
  | "batch_ingested"
  | "compaction_complete"
  | "output_synced"
  | "sync_complete"
  | "sync_error"
  | "model_start"
  | "model_thread_resumed"
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

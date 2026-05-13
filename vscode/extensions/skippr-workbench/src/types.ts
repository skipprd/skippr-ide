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

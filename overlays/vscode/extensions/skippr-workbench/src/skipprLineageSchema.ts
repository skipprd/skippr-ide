export interface LineageNodeLike {
  id: string;
  label: string;
  kind: string;
  dataset_id?: string;
  path?: string;
  metadata?: Record<string, string>;
  field?: { dataset_id?: string; field_path?: string; field_id?: number };
}

export interface LineageEdgeLike {
  id?: string;
  from_node_id: string;
  to_node_id: string;
  kind: string;
  metadata?: Record<string, string>;
}

export interface LineageGraphLike {
  nodes?: LineageNodeLike[];
  edges?: LineageEdgeLike[];
}

export interface LineageSchemaField {
  fieldPath: string;
  fieldNodeId?: string;
  fieldType?: string;
  nullable?: boolean;
  state?: string;
}

export interface LineageSchemaPayload {
  node?: { id: string; label: string; datasetId?: string; kind?: string };
  fields: LineageSchemaField[];
}

export interface LineageResourceRef {
  kind: string;
  label: string;
  target?: string;
}

export type LineageResourceAction =
  | "openFile"
  | "openMetadata"
  | "openConfig"
  | "copyNodeId"
  | "copyDatasetId"
  | "copyStorageLocation";

const RESOURCE_ACTION_BY_KIND: Record<string, LineageResourceAction> = {
  metadata: "openMetadata",
  config: "openConfig",
  source_file: "openFile",
  storage_location: "openMetadata",
  dataset_id: "copyDatasetId",
  node_id: "copyNodeId"
};

function isFieldNode(node: LineageNodeLike): boolean {
  return String(node.kind || "").toLowerCase() === "field";
}

function lineageState(node: LineageNodeLike): string {
  return String(node.metadata?._lineage_state || "normal");
}

export function parseLineageResources(metadata?: Record<string, string>): LineageResourceRef[] {
  const raw = metadata?.lineage_resources?.trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as LineageResourceRef[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fieldNodeById(graph: LineageGraphLike, fieldNodeId: string): LineageNodeLike | undefined {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  return nodes.find((node) => node.id === fieldNodeId);
}

export function schemaFieldsForEntity(node: LineageNodeLike | undefined, graph: LineageGraphLike): LineageSchemaField[] {
  if (!node) {
    return [];
  }
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const fieldNodeIds = edges
    .filter((edge) => edge.kind === "contains_field" && edge.from_node_id === node.id)
    .map((edge) => edge.to_node_id);
  const fields = fieldNodeIds
    .map((fieldNodeId) => fieldNodeById(graph, fieldNodeId))
    .filter((fieldNode): fieldNode is LineageNodeLike => Boolean(fieldNode))
    .filter(isFieldNode)
    .map((fieldNode) => ({
      fieldPath: String(fieldNode.field?.field_path || fieldNode.label || fieldNode.id),
      fieldNodeId: fieldNode.id,
      fieldType: fieldNode.metadata?.type?.trim() || undefined,
      nullable:
        fieldNode.metadata?.nullable === "true"
          ? true
          : fieldNode.metadata?.nullable === "false"
            ? false
            : undefined,
      state: lineageState(fieldNode)
    }))
    .filter((field) => field.fieldPath.length > 0)
    .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
  return fields;
}

export function lineageActionsForNode(node: LineageNodeLike | undefined): LineageResourceAction[] {
  if (!node) {
    return [];
  }
  const resources = parseLineageResources(node.metadata);
  const actions = resources
    .map((resource) => RESOURCE_ACTION_BY_KIND[String(resource.kind || "").toLowerCase()])
    .filter((action): action is LineageResourceAction => Boolean(action));
  return [...new Set(actions)];
}

export function lineageActionLabel(action: LineageResourceAction): string {
  switch (action) {
    case "openFile":
      return "Open file";
    case "openMetadata":
      return "Open metadata";
    case "openConfig":
      return "Open skippr.yml";
    case "copyNodeId":
      return "Copy node id";
    case "copyDatasetId":
      return "Copy dataset id";
    case "copyStorageLocation":
      return "Copy storage location";
    default:
      return action;
  }
}

export function lineageResourceTarget(
  node: LineageNodeLike | undefined,
  action: LineageResourceAction
): string | undefined {
  if (!node) {
    return undefined;
  }
  const resources = parseLineageResources(node.metadata);
  const kind = Object.entries(RESOURCE_ACTION_BY_KIND).find(([, mapped]) => mapped === action)?.[0];
  if (!kind) {
    return undefined;
  }
  return resources.find((resource) => String(resource.kind || "").toLowerCase() === kind)?.target;
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  lineageActionsForNode,
  parseLineageResources,
  schemaFieldsForEntity,
  type LineageGraphLike,
  type LineageNodeLike
} from "./skipprLineageSchema.js";

test("schemaFieldsForEntity follows contains_field edges", () => {
  const source: LineageNodeLike = {
    id: "raw:orders",
    label: "orders",
    kind: "raw_source",
    dataset_id: "source:orders"
  };
  const field: LineageNodeLike = {
    id: "field:source:orders:order_id",
    label: "order_id",
    kind: "field",
    dataset_id: "source:orders",
    field: { dataset_id: "source:orders", field_path: "order_id" },
    metadata: { type: "Long", nullable: "false" }
  };
  const graph: LineageGraphLike = {
    nodes: [source, field],
    edges: [{ from_node_id: source.id, to_node_id: field.id, kind: "contains_field" }]
  };
  const fields = schemaFieldsForEntity(source, graph);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].fieldPath, "order_id");
  assert.equal(fields[0].fieldNodeId, field.id);
  assert.equal(fields[0].fieldType, "Long");
  assert.equal(fields[0].nullable, false);
});

test("lineageActionsForNode uses lineage_resources metadata", () => {
  const node: LineageNodeLike = {
    id: "raw:orders",
    label: "orders",
    kind: "raw_source",
    metadata: {
      lineage_resources: JSON.stringify([
        { kind: "metadata", label: "Open metadata", target: "s3://bucket/key.json" }
      ])
    }
  };
  const actions = lineageActionsForNode(node);
  assert.deepEqual(actions, ["openMetadata"]);
  const resources = parseLineageResources(node.metadata);
  assert.equal(resources.length, 1);
  assert.equal(resources[0].kind, "metadata");
});

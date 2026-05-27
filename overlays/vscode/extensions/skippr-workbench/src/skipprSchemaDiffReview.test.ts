import assert from "node:assert/strict";
import {
  applyRowDecisions,
  buildDiffRows,
  buildReviewState,
  isReviewDirty,
  reconstructBeforeFields
} from "./skipprSchemaDiffReview";
import type { SkipprRunSchemaField } from "./types";

const afterFields: SkipprRunSchemaField[] = [
  { name: "id", field_type: "string", nullable: false },
  { name: "amount", field_type: "double", nullable: true },
  { name: "created_at", field_type: "date", nullable: true }
];

const diff = {
  added: ["created_at"],
  removed: [] as string[],
  changed: [
    {
      name: "amount",
      before: { name: "amount", field_type: "long", nullable: true },
      after: { name: "amount", field_type: "double", nullable: true }
    }
  ]
};

const rows = buildDiffRows(diff, afterFields);
assert.equal(rows.length, 2);
assert.equal(rows.find((r) => r.kind === "added")?.fieldName, "created_at");

const beforeMap = reconstructBeforeFields(diff, afterFields);
assert.equal(beforeMap.has("created_at"), false);
assert.equal(beforeMap.get("amount")?.field_type, "long");

let applied = applyRowDecisions(rows, afterFields);
assert.equal(applied.some((f) => f.name === "created_at"), true);
assert.equal(applied.find((f) => f.name === "amount")?.field_type, "double");

const rejectAdded = rows.map((row) =>
  row.kind === "added" ? { ...row, decision: "rejected" as const } : row
);
applied = applyRowDecisions(rejectAdded, afterFields);
assert.equal(applied.some((f) => f.name === "created_at"), false);

const state = buildReviewState([{ namespace: "events", diff, schema: { fields: afterFields } }]);
assert.equal(state.namespaces.length, 1);
assert.equal(isReviewDirty(state.namespaces[0].rows), false);

const dirtyState = buildReviewState([
  {
    namespace: "events",
    diff,
    schema: { fields: afterFields }
  }
]);
dirtyState.namespaces[0].rows = dirtyState.namespaces[0].rows.map((row, index) =>
  index === 0 ? { ...row, decision: "rejected" as const } : row
);
assert.equal(isReviewDirty(dirtyState.namespaces[0].rows), true);

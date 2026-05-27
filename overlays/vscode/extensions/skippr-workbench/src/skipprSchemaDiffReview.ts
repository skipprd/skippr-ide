import type { SkipprRunSchemaField, SkipprSchemaDiffPayload } from "./types";

export type SchemaDiffRowKind = "added" | "removed" | "changed";
export type SchemaDiffRowDecision = "pending" | "approved" | "rejected";

export interface SchemaDiffRow {
  id: string;
  kind: SchemaDiffRowKind;
  fieldName: string;
  before?: SkipprRunSchemaField;
  after?: SkipprRunSchemaField;
  decision: SchemaDiffRowDecision;
  editedAfter?: SkipprRunSchemaField;
}

export interface SchemaDiffReviewNamespace {
  namespace: string;
  rows: SchemaDiffRow[];
}

export interface SchemaDiffReviewState {
  namespaces: SchemaDiffReviewNamespace[];
  dirty: boolean;
}

const DEFAULT_DECISION: SchemaDiffRowDecision = "approved";

function fieldKey(field: SkipprRunSchemaField | undefined): string {
  if (!field) {
    return "";
  }
  return `${field.name ?? ""}|${field.field_type ?? ""}|${field.nullable === false ? "0" : "1"}`;
}

function afterFieldsMap(afterFields: SkipprRunSchemaField[]): Map<string, SkipprRunSchemaField> {
  const map = new Map<string, SkipprRunSchemaField>();
  for (const field of afterFields) {
    const name = field.name?.trim();
    if (name) {
      map.set(name, field);
    }
  }
  return map;
}

/** Reconstruct the pre-discover field set from the diff and post-discover schema snapshot. */
export function reconstructBeforeFields(
  diff: SkipprSchemaDiffPayload,
  afterFields: SkipprRunSchemaField[]
): Map<string, SkipprRunSchemaField> {
  const afterMap = afterFieldsMap(afterFields);
  const before = new Map(afterMap);

  for (const name of diff.added ?? []) {
    const trimmed = name?.trim();
    if (trimmed) {
      before.delete(trimmed);
    }
  }

  for (const entry of diff.changed ?? []) {
    const name = entry.name?.trim();
    if (name && entry.before) {
      before.set(name, { ...entry.before, name });
    }
  }

  for (const name of diff.removed ?? []) {
    const trimmed = name?.trim();
    if (!trimmed || before.has(trimmed)) {
      continue;
    }
    before.set(trimmed, {
      name: trimmed,
      field_type: "string",
      nullable: true
    });
  }

  return before;
}

export function buildDiffRows(
  diff: SkipprSchemaDiffPayload,
  afterSchemaFields: SkipprRunSchemaField[]
): SchemaDiffRow[] {
  const afterMap = afterFieldsMap(afterSchemaFields);
  const beforeMap = reconstructBeforeFields(diff, afterSchemaFields);
  const rows: SchemaDiffRow[] = [];

  for (const name of [...(diff.added ?? [])].sort()) {
    const trimmed = name?.trim();
    if (!trimmed) {
      continue;
    }
    rows.push({
      id: `added:${trimmed}`,
      kind: "added",
      fieldName: trimmed,
      after: afterMap.get(trimmed) ?? { name: trimmed, field_type: "string", nullable: true },
      decision: DEFAULT_DECISION
    });
  }

  for (const name of [...(diff.removed ?? [])].sort()) {
    const trimmed = name?.trim();
    if (!trimmed) {
      continue;
    }
    rows.push({
      id: `removed:${trimmed}`,
      kind: "removed",
      fieldName: trimmed,
      before: beforeMap.get(trimmed) ?? { name: trimmed, field_type: "string", nullable: true },
      decision: DEFAULT_DECISION
    });
  }

  for (const entry of [...(diff.changed ?? [])].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "")
  )) {
    const trimmed = entry.name?.trim();
    if (!trimmed) {
      continue;
    }
    rows.push({
      id: `changed:${trimmed}`,
      kind: "changed",
      fieldName: trimmed,
      before: entry.before ?? beforeMap.get(trimmed),
      after: entry.after ?? afterMap.get(trimmed),
      decision: DEFAULT_DECISION
    });
  }

  return rows;
}

function effectiveAfter(row: SchemaDiffRow): SkipprRunSchemaField | undefined {
  if (row.kind === "changed") {
    return row.editedAfter ?? row.after;
  }
  return row.after;
}

/** Apply approve/reject decisions to produce the field list for `metadata apply`. */
export function applyRowDecisions(
  rows: SchemaDiffRow[],
  afterFields: SkipprRunSchemaField[]
): SkipprRunSchemaField[] {
  const afterMap = afterFieldsMap(afterFields);
  const result = new Map<string, SkipprRunSchemaField>();

  for (const [name, field] of afterMap) {
    result.set(name, { ...field, name });
  }

  for (const row of rows) {
    const name = row.fieldName;
    const approved = row.decision !== "rejected";

    if (row.kind === "added") {
      if (approved) {
        const field = effectiveAfter(row) ?? { name, field_type: "string", nullable: true };
        result.set(name, { ...field, name });
      } else {
        result.delete(name);
      }
      continue;
    }

    if (row.kind === "removed") {
      if (approved) {
        result.delete(name);
      } else if (row.before) {
        result.set(name, { ...row.before, name });
      }
      continue;
    }

    if (row.kind === "changed") {
      if (approved) {
        const field = effectiveAfter(row) ?? row.after ?? { name, field_type: "string", nullable: true };
        result.set(name, { ...field, name });
      } else if (row.before) {
        result.set(name, { ...row.before, name });
      }
    }
  }

  return [...result.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export function isRowDirty(row: SchemaDiffRow): boolean {
  if (row.decision !== DEFAULT_DECISION) {
    return true;
  }
  if (row.kind === "changed" && row.editedAfter) {
    return fieldKey(row.editedAfter) !== fieldKey(row.after);
  }
  return false;
}

export function isReviewDirty(rows: SchemaDiffRow[]): boolean {
  return rows.some(isRowDirty);
}

export function buildReviewState(
  changes: Array<{ namespace: string; diff: SkipprSchemaDiffPayload; schema?: { fields?: SkipprRunSchemaField[] } }>
): SchemaDiffReviewState {
  const namespaces = changes.map((change) => {
    const afterFields = Array.isArray(change.schema?.fields) ? change.schema.fields : [];
    const rows = buildDiffRows(change.diff, afterFields);
    return { namespace: change.namespace, rows };
  });
  const dirty = namespaces.some((ns) => isReviewDirty(ns.rows));
  return { namespaces, dirty };
}

export function reviewStateFromRows(namespaces: SchemaDiffReviewNamespace[]): SchemaDiffReviewState {
  return {
    namespaces,
    dirty: namespaces.some((ns) => isReviewDirty(ns.rows))
  };
}

export function setAllRowDecisions(
  rows: SchemaDiffRow[],
  decision: SchemaDiffRowDecision
): SchemaDiffRow[] {
  return rows.map((row) => ({
    ...row,
    decision,
    editedAfter: decision === DEFAULT_DECISION ? undefined : row.editedAfter
  }));
}

export function resetRowsToDefaults(rows: SchemaDiffRow[], afterFields: SkipprRunSchemaField[]): SchemaDiffRow[] {
  return buildDiffRows(
    rowsToDiff(rows),
    afterFields
  );
}

function rowsToDiff(rows: SchemaDiffRow[]): SkipprSchemaDiffPayload {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: NonNullable<SkipprSchemaDiffPayload["changed"]> = [];
  for (const row of rows) {
    if (row.kind === "added") {
      added.push(row.fieldName);
    } else if (row.kind === "removed") {
      removed.push(row.fieldName);
    } else if (row.kind === "changed") {
      changed.push({
        name: row.fieldName,
        before: row.before,
        after: row.after
      });
    }
  }
  return { added, removed, changed };
}

export function dirtyNamespaces(state: SchemaDiffReviewState): SchemaDiffReviewNamespace[] {
  return state.namespaces.filter((ns) => isReviewDirty(ns.rows));
}

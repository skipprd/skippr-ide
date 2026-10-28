import type { SkipprRunEvent } from "./types";

export function describeRunEvent(event: SkipprRunEvent): string | undefined {
  switch (event.event) {
    case "discover_start":
      return `Discover started: ${event.pipeline ?? "pipeline"}`;
    case "namespace_discovered":
      return `Discovered ${event.namespace ?? event.schema?.namespace ?? "namespace"} (${event.field_count ?? 0} fields)`;
    case "schema_evolved":
      return `Schema evolved: ${event.namespace ?? "namespace"} (${event.fields_added?.length ?? 0} added)`;
    case "discover_complete":
      return `Discover complete: ${event.pipeline ?? "pipeline"} (${event.namespaces_discovered ?? 0} namespaces)`;
    case "sync_start":
      return `Sync started: ${event.pipeline ?? "pipeline"}`;
    case "sync_status":
      return `Sync status: ${event.pipeline ?? "pipeline"} rows=${event.total_rows ?? event.metrics?.messages_total ?? 0} written=${event.rows_written ?? 0}`;
    case "batch_ingested":
      return `Batch ingested: ${event.namespace ?? "namespace"} rows=${event.rows ?? 0}`;
    case "compaction_complete":
      return `Compaction complete: ${event.namespace ?? "namespace"}`;
    case "output_synced":
      return `Output synced: ${event.namespace ?? "namespace"} rows=${event.rows_written ?? 0}`;
    case "sync_complete":
      return `Sync complete: ${event.pipeline ?? "pipeline"} rows=${event.total_rows ?? 0}`;
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
    case "model_thread_resumed":
      return `Model resumed thread ${event.thread_id ?? "unknown"}`;
    case "model_preflight":
      return event.model_preflight?.ok
        ? `Model preflight passed: ${event.model_preflight.command ?? "dbt"}`
        : `Model preflight failed: ${event.model_preflight?.remediation ?? event.error ?? "dbt environment issue"}`;
    case "model_authoring_start":
      return "Model authoring started";
    case "model_file_changed":
      return `Model files changed: ${event.changed_files?.length ?? 0}`;
    case "model_review_ready":
      return event.summary ?? `Model review ready: ${event.total_count ?? event.changed_files?.length ?? 0} files`;
    case "model_validation_start":
      return "Model validation started";
    case "model_validation":
      return event.validation?.ok
        ? "Model validation passed"
        : `Model validation failed: ${event.validation?.message ?? event.error ?? "unknown error"}`;
    case "model_validation_complete":
      return event.validation?.ok
        ? "Model validation passed"
        : `Model validation failed: ${event.validation?.message ?? event.error ?? "unknown error"}`;
    case "model_phase_changed":
      return `Model phase: ${event.phase ?? "unknown"}`;
    case "model_complete":
      return `Model complete: ${event.pipeline ?? "pipeline"}`;
    case "model_error":
      return `Model error: ${event.error ?? event.failure_summary ?? "unknown error"}`;
    case "ask_start":
      return `Ask started: ${event.pipeline ?? "pipeline"}`;
    case "ask_complete":
      return `Ask complete: ${event.pipeline ?? "pipeline"}`;
    case "ask_error":
      return `Ask error: ${event.error ?? "unknown error"}`;
    case "plan_start":
      return `Plan started: ${event.pipeline ?? "pipeline"}`;
    case "plan_complete":
      return `Plan complete: ${event.pipeline ?? "pipeline"}`;
    case "plan_error":
      return `Plan error: ${event.error ?? "unknown error"}`;
  }
  return undefined;
}

export function describedRunEvents(events: SkipprRunEvent[]): SkipprRunEvent[] {
  return events.map((event) => ({
    ...event,
    description: describeRunEvent(event) ?? event.event
  }));
}

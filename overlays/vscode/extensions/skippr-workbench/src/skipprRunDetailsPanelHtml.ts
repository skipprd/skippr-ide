export type SkipprRunDetailsViewKind = "timeline" | "schema" | "deadletters";

export function renderSkipprRunDetailsPanelHtml(viewKind: SkipprRunDetailsViewKind): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-panel-background, var(--vscode-editor-background)); font: 12px var(--vscode-font-family); }
    .toolbar { height: 28px; display: flex; align-items: center; gap: 16px; padding: 0 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-panel-background, var(--vscode-editor-background)); }
    .toolbar strong { font-weight: 600; }
    .muted { color: var(--vscode-descriptionForeground); }
    .stats { display: grid; grid-template-columns: repeat(6, minmax(110px, 1fr)); border-bottom: 1px solid var(--vscode-panel-border); }
    .stat { min-height: 38px; padding: 5px 8px; border-right: 1px solid var(--vscode-panel-border); }
    .label { color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .value { margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model-summary { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .model-headline { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
    .model-headline strong { font-size: 13px; font-weight: 600; }
    .badge { display: inline-flex; align-items: center; min-height: 18px; padding: 0 6px; border: 1px solid var(--vscode-panel-border); font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
    .badge.running { color: var(--vscode-textLink-foreground); border-color: var(--vscode-textLink-foreground); }
    .badge.success { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); }
    .badge.error { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
    .badge.stopped { color: var(--vscode-editorWarning-foreground); border-color: var(--vscode-editorWarning-foreground); }
    .model-meta { margin-top: 5px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
    .model-alert { margin-top: 8px; padding: 7px 8px; border-left: 2px solid var(--vscode-errorForeground); background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground) 55%, transparent); }
    .model-alert.warn { border-left-color: var(--vscode-editorWarning-foreground); background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground) 55%, transparent); }
    .model-section-title { padding: 6px 10px 4px; color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid var(--vscode-panel-border); }
    .ok { color: var(--vscode-testing-iconPassed); }
    .bad { color: var(--vscode-errorForeground); }
    .warn { color: var(--vscode-editorWarning-foreground); }
    .file-list { border-bottom: 1px solid var(--vscode-panel-border); padding: 4px 10px 8px; }
    .file-row { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
    .file-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-kind { color: var(--vscode-descriptionForeground); font-size: 11px; flex-shrink: 0; }
    .file-diff { color: var(--vscode-descriptionForeground); font-size: 11px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .metric-panel { border-bottom: 1px solid var(--vscode-panel-border); }
    .metric-tabs { height: 28px; display: flex; align-items: stretch; border-bottom: 1px solid var(--vscode-panel-border); }
    .metric-tab { all: unset; box-sizing: border-box; min-width: 92px; padding: 0 10px; display: flex; align-items: center; justify-content: center; border-right: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); cursor: pointer; }
    .metric-tab:hover { background: var(--vscode-list-hoverBackground); }
    .metric-tab.active { color: var(--vscode-foreground); background: var(--vscode-list-activeSelectionBackground); }
    .metric-copy { padding: 7px 10px 0; color: var(--vscode-descriptionForeground); }
    .legend { display: flex; align-items: center; gap: 14px; padding: 7px 10px; color: var(--vscode-descriptionForeground); }
    .legend-item { display: inline-flex; align-items: center; gap: 5px; }
    .swatch { width: 10px; height: 10px; display: inline-block; background: var(--vscode-charts-blue); }
    .swatch.synced { background: var(--vscode-charts-green); }
    .histogram { height: 120px; padding: 0 10px 10px; display: flex; align-items: flex-end; gap: 4px; overflow: hidden; }
    .bucket { flex: 1; min-width: 8px; height: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 2px; }
    .bar { width: 45%; min-height: 4px; background: var(--vscode-charts-blue); opacity: .9; cursor: default; }
    .bar.synced { background: var(--vscode-charts-green); }
    .bar.zero { opacity: .35; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; vertical-align: top; }
    th { color: var(--vscode-descriptionForeground); font-weight: 500; background: var(--vscode-editor-background); }
    pre { white-space: pre-wrap; margin: 0; font-family: var(--vscode-editor-font-family); }
    .empty { padding: 10px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <main id="root"></main>
  <script>
    (function () {
      let state = {};
      let metricMode = "rows";
      const viewKind = "${viewKind}";
      const root = document.getElementById("root");
      function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
      function num(v) { return typeof v === "number" ? v.toLocaleString() : "0"; }
      function elapsedMs(run) {
        if (typeof run.elapsedMs === "number") {
          return run.elapsedMs;
        }
        if (typeof run.startedAt === "number") {
          const end = typeof run.finishedAt === "number" ? run.finishedAt : Date.now();
          return Math.max(0, end - run.startedAt);
        }
        return 0;
      }
      function duration(run) {
        const ms = elapsedMs(run);
        return (ms / 1000).toFixed(ms > 10000 ? 0 : 1) + "s";
      }
      function selected() { return state.selected || state.current; }
      function isModelRun(run) {
        const kind = String((run && (run.runKind || run.command)) || "");
        return kind === "model" || kind === "model-direct" || kind === "direct" || kind.startsWith("model");
      }
      function header(run) {
        if (!run) { return ""; }
        const phase = run.phase ? '<span class="muted">' + esc(run.phase) + '</span>' : "";
        return '<div class="toolbar"><strong>' + esc(run.pipeline || run.label || run.command || "Skippr run") + '</strong><span class="muted">' + esc(run.status || "") + '</span><span class="muted">' + esc(run.runKind || run.command || "") + '</span>' + phase + '</div>';
      }
      function valueOf(point, keys) {
        for (const key of keys) {
          const value = Number(point && point[key]);
          if (Number.isFinite(value)) { return value; }
        }
        return 0;
      }
      function counterDelta(current, previous) {
        if (current < previous) {
          return current;
        }
        return current - previous;
      }
      function intervalBuckets(points, processingKeys, syncedKeys) {
        let previousProcessing = 0;
        let previousSynced = 0;
        return points.map(point => {
          const processingCurrent = valueOf(point, processingKeys);
          const syncedCurrent = valueOf(point, syncedKeys);
          const bucket = {
            timestamp: point.timestamp || "",
            processing: counterDelta(processingCurrent, previousProcessing),
            synced: counterDelta(syncedCurrent, previousSynced)
          };
          previousProcessing = Math.max(previousProcessing, processingCurrent);
          previousSynced = Math.max(previousSynced, syncedCurrent);
          return bucket;
        });
      }
      const HISTOGRAM_POINTS = 30;
      function emptyBucket() {
        return { timestamp: "", processing: 0, synced: 0 };
      }
      function fixedHistogramBuckets(buckets) {
        const recent = buckets.slice(-HISTOGRAM_POINTS);
        while (recent.length < HISTOGRAM_POINTS) {
          recent.unshift(emptyBucket());
        }
        return recent;
      }
      function metricBuckets(run, mode) {
        const points = run && run.metricPoints ? run.metricPoints : [];
        if (mode === "bytes") {
          return {
            note: "Each bar shows bytes handled during that interval. Blue is ingestion/WAL; green is persisted for destination sync.",
            buckets: intervalBuckets(points, ["bytes_total"], ["parquet_persisted_bytes_total"])
          };
        }
        if (mode === "deadletters") {
          return {
            note: "Each bar shows deadletters recorded during that interval.",
            buckets: intervalBuckets(points, ["deadletters_total"], [])
          };
        }
        return {
          note: "Each bar shows rows handled during that interval. Blue is ingestion/WAL; green is synced or persisted toward the destination.",
          buckets: intervalBuckets(points, ["wal_write_rows_total", "messages_total"], ["rows_written", "parquet_persisted_rows_total"])
        };
      }
      function barTitle(label, value, timestamp) {
        const when = timestamp ? esc(timestamp) + " — " : "";
        return when + label + ": " + esc(num(value));
      }
      function barHeight(value, max) {
        if (value <= 0) {
          return "4px";
        }
        return Math.max(4, Math.round((value / max) * 100)) + "%";
      }
      function histogram(run) {
        const metric = metricBuckets(run, metricMode);
        const buckets = fixedHistogramBuckets(metric.buckets);
        const max = Math.max(1, ...buckets.flatMap(b => [b.processing, b.synced]));
        const tabs = ["rows", "deadletters", "bytes"].map(mode =>
          '<button class="metric-tab ' + (mode === metricMode ? "active" : "") + '" data-metric="' + mode + '">' + esc(mode[0].toUpperCase() + mode.slice(1)) + '</button>'
        ).join("");
        const bars = buckets.map(bucket =>
          '<div class="bucket">' +
            '<div class="bar processing' + (bucket.processing <= 0 ? " zero" : "") + '" title="' + barTitle("Processing in WAL", bucket.processing, bucket.timestamp) + '" style="height:' + barHeight(bucket.processing, max) + '"></div>' +
            '<div class="bar synced' + (bucket.synced <= 0 ? " zero" : "") + '" title="' + barTitle("Synced to destination", bucket.synced, bucket.timestamp) + '" style="height:' + barHeight(bucket.synced, max) + '"></div>' +
          '</div>'
        ).join("");
        return '<section class="metric-panel">' +
          '<div class="metric-tabs">' + tabs + '</div>' +
          '<div class="metric-copy">' + esc(metric.note) + '</div>' +
          '<div class="legend"><span class="legend-item"><span class="swatch"></span>Processing in WAL</span><span class="legend-item"><span class="swatch synced"></span>Synced to destination</span></div>' +
          '<div class="histogram">' + bars + '</div>' +
        '</section>';
      }
      function syncRunView(run) {
        if (!run) { return '<div class="empty">No run selected.</div>'; }
        const timelineRows = (run.events || [])
          .filter(e => e.event !== "sync_status")
          .map(e => [e.timestamp || "", e.event, e.namespace || e.pipeline || "", eventDetail(e)]);
        if (run.status === "error" && run.detail && !timelineRows.some(row => row[3] === run.detail)) {
          timelineRows.push([run.finishedAt ? new Date(run.finishedAt).toISOString() : "", "run_error", run.pipeline || "", run.detail]);
        }
        return header(run) + '<div class="stats">' +
          stat("Status", run.status) + stat("Duration", duration(run)) + stat("Rows", num(run.totalRows ?? run.rowsWritten)) + stat("Bytes", num(run.bytesTotal)) + stat("Freshness", run.freshness && run.freshness.latest_iso ? new Date(run.freshness.latest_iso).toLocaleString() : "n/a") + stat("Deadletters", num(run.deadletters && run.deadletters.total)) +
        '</div>' + histogram(run) + table(timelineRows, ["Time", "Event", "Scope", "Detail"]);
      }
      function statusBadge(status) {
        const value = status || "idle";
        const label = value === "running" ? "Running" : value === "success" ? "Success" : value === "error" ? "Failed" : value === "stopped" ? "Stopped" : String(value);
        return '<span class="badge ' + esc(value) + '">' + esc(label) + '</span>';
      }
      function modelRunView(run) {
        if (!run) { return '<div class="empty">No run selected.</div>'; }
        const fileSummary = modelFileSummary(run);
        const timelineRows = significantModelTimeline(run);
        return modelSummary(run, fileSummary) + modelFiles(run, fileSummary) + modelTimeline(timelineRows);
      }
      function modelSummary(run, fileSummary) {
        const preflight = run.modelPreflight || {};
        const validation = run.modelValidation || {};
        const metaParts = [duration(run)];
        if (run.phase) { metaParts.push(run.phase); }
        metaParts.push(modelInsightLine(preflight, validation, fileSummary, run));
        return '<section class="model-summary">' +
          '<div class="model-headline"><strong>' + esc(run.pipeline || run.label || "Model run") + '</strong>' + statusBadge(run.status) + '</div>' +
          '<div class="model-meta">' + esc(metaParts.join(" · ")) + '</div>' +
          modelAlert(run, preflight, validation) +
        '</section>';
      }
      function modelInsightLine(preflight, validation, summary, run) {
        const parts = [];
        if (preflight.ok === true) { parts.push("dbt ready"); }
        else if (preflight.ok === false) { parts.push("dbt blocked"); }
        else { parts.push("dbt pending"); }
        if (summary.total > 0) { parts.push(fileChangePhrase(summary)); }
        else { parts.push("no file changes"); }
        if (validation.ok === true) { parts.push("validated"); }
        else if (validation.ok === false) {
          const errors = Array.isArray(validation.errors) ? validation.errors.length : 0;
          parts.push(errors > 0 ? "validation failed (" + errors + ")" : "validation failed");
        }
        if ((run.events || []).some(e => e.event === "model_thread_resumed")) { parts.push("resumed thread"); }
        if (run.modelPendingPlanRevision) { parts.push("plan revision pending"); }
        return parts.join(" · ");
      }
      function fileChangePhrase(summary) {
        const bits = [];
        if (summary.created > 0) { bits.push(summary.created + " created"); }
        if (summary.modified > 0) { bits.push(summary.modified + " modified"); }
        if (summary.deleted > 0) { bits.push(summary.deleted + " deleted"); }
        if (!bits.length) { return summary.total + " file" + (summary.total === 1 ? "" : "s") + " changed"; }
        return bits.join(", ");
      }
      function modelAlert(run, preflight, validation) {
        if (run.status === "error" && run.detail) {
          return '<div class="model-alert">' + esc(run.detail) + '</div>';
        }
        if (preflight.ok === false) {
          const detail = preflight.remediation || preflight.stderr || "dbt preflight failed";
          const extra = preflight.command ? " (" + preflight.command + ")" : "";
          return '<div class="model-alert">' + esc(detail + extra) + '</div>';
        }
        if (validation.ok === false) {
          const detail = validation.message || "Model validation failed";
          return '<div class="model-alert">' + esc(detail) + '</div>';
        }
        if (run.modelRepairStatus && run.modelRepairStatus !== "n/a" && run.modelRepairStatus !== "none") {
          return '<div class="model-alert warn">Repair: ' + esc(run.modelRepairStatus) + '</div>';
        }
        return "";
      }
      function significantModelTimeline(run) {
        const significant = new Set([
          "model_start", "model_thread_resumed", "model_preflight", "model_authoring_start",
          "model_file_changed", "model_review_ready", "model_validation_start",
          "model_validation", "model_validation_complete", "model_phase_changed",
          "model_complete", "model_error"
        ]);
        const rows = (run.events || [])
          .filter(e => significant.has(e.event) || (e.event === "tool_end" && e.status === "error"))
          .map(e => [e.timestamp || "", modelEventLabel(e), modelEventDetail(e)]);
        if (run.status === "error" && run.detail && !rows.some(row => row[2] === run.detail)) {
          rows.push([run.finishedAt ? new Date(run.finishedAt).toISOString() : "", "Run failed", run.detail]);
        }
        return rows;
      }
      function modelEventLabel(event) {
        switch (event.event) {
          case "model_start": return "Started";
          case "model_thread_resumed": return "Thread resumed";
          case "model_preflight": return "dbt preflight";
          case "model_authoring_start": return "Authoring";
          case "model_file_changed": return "Files changed";
          case "model_review_ready": return "Review ready";
          case "model_validation_start": return "Validation started";
          case "model_validation":
          case "model_validation_complete": return "Validation";
          case "model_phase_changed": return event.phase ? "Phase: " + event.phase : "Phase changed";
          case "model_complete": return "Complete";
          case "model_error": return "Error";
          case "tool_end": return (event.clean_name || event.name || "Tool") + " failed";
          default: return event.event || "Event";
        }
      }
      function modelTimeline(rows) {
        if (!rows.length) { return ""; }
        return '<div class="model-section-title">Timeline</div>' + table(rows, ["Time", "Event", "Detail"]);
      }
      function modelFileSummary(run) {
        const initial = run.modelFileSummary || {};
        const summary = {
          created: Number(initial.created_count || 0),
          modified: Number(initial.modified_count || 0),
          deleted: Number(initial.deleted_count || 0),
          linesAdded: Number(initial.lines_added || 0),
          linesRemoved: Number(initial.lines_removed || 0),
          total: Number(initial.total_count || 0)
        };
        if (summary.total > 0) { return summary; }
        for (const file of run.modelChangedFiles || []) {
          if (file.change_kind === "created") { summary.created++; }
          else if (file.change_kind === "deleted") { summary.deleted++; }
          else { summary.modified++; }
          summary.linesAdded += Number(file.lines_added || 0);
          summary.linesRemoved += Number(file.lines_removed || 0);
          summary.total++;
        }
        return summary;
      }
      function modelFiles(run, summary) {
        const files = run.modelChangedFiles || [];
        if (!files.length) {
          return "";
        }
        const rows = files.slice(0, 20).map(file => {
          const added = Number(file.lines_added || 0);
          const removed = Number(file.lines_removed || 0);
          const diff = added > 0 || removed > 0 ? '<span class="file-diff">+' + esc(added) + ' -' + esc(removed) + '</span>' : "";
          return '<div class="file-row"><span class="file-path" title="' + esc(file.absolute_path || file.path || "") + '">' + esc(file.path || file.absolute_path || "changed file") + '</span><span class="file-kind">' + esc(file.change_kind || "modified") + '</span>' + diff + '</div>';
        }).join("");
        const more = files.length > 20 ? '<div class="empty">+' + esc(files.length - 20) + ' more files</div>' : "";
        return '<div class="model-section-title">Changed files</div><section class="file-list">' + rows + more + '</section>';
      }
      function schemaView(run) {
        if (!run) { return '<div class="empty">No run selected.</div>'; }
        const rows = (run.schemaChanges || []).map(change => [change.timestamp, change.namespace, JSON.stringify(change.diff, null, 2)]);
        return header(run) + (rows.length ? table(rows, ["Time", "Namespace", "Informational Diff"]) : '<div class="empty">No schema changes captured.</div>');
      }
      function deadletterView(run) {
        if (!run) { return '<div class="empty">No run selected.</div>'; }
        return header(run) + '<div class="stats">' + stat("Configured", run.deadletters && run.deadletters.configured ? "yes" : "no") + stat("Total", num(run.deadletters && run.deadletters.total)) + '</div><div class="empty">Deadletter row tailing will appear here once skipprd exposes sink-agnostic tailing.</div>';
      }
      function stat(label, value) { return '<section class="stat"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div></section>'; }
      function eventDetail(event) {
        return event.error || event.failure_summary || event.repair_status || event.phase || "";
      }
      function modelEventDetail(event) {
        if (event.event === "tool_start") {
          return (event.clean_name || event.name || "tool") + " running";
        }
        if (event.event === "tool_end") {
          return (event.clean_name || event.name || "tool") + " " + (event.status || "finished") + (event.error ? ": " + event.error : "");
        }
        if (event.event === "model_preflight") {
          const pre = event.model_preflight || {};
          return pre.ok ? "dbt ready" : (pre.remediation || event.error || "dbt preflight failed");
        }
        if (event.event === "model_thread_resumed") {
          return "thread " + (event.thread_id || "unknown") + " resumed";
        }
        if (event.event === "model_file_changed" || event.event === "model_review_ready") {
          const files = event.changed_files || [];
          const created = event.created_count != null ? event.created_count : files.filter(file => file.change_kind === "created").length;
          const modified = event.modified_count != null ? event.modified_count : files.filter(file => file.change_kind === "modified").length;
          const deleted = event.deleted_count != null ? event.deleted_count : files.filter(file => file.change_kind === "deleted").length;
          return event.summary || (files.length + " files: " + created + " created, " + modified + " modified, " + deleted + " deleted");
        }
        if (event.event === "model_validation" || event.event === "model_validation_complete") {
          const validation = event.validation || {};
          return validation.message || (validation.ok ? "validation passed" : "validation failed");
        }
        if (event.event === "model_validation_start") {
          return "validation started";
        }
        if (event.event === "model_authoring_start") {
          return "agent authoring started";
        }
        return event.error || event.failure_summary || event.summary || event.repair_status || event.phase || "";
      }
      function table(rows, headings) {
        const head = headings ? '<tr>' + headings.map(h => '<th>' + esc(h) + '</th>').join("") + '</tr>' : "";
        return '<table>' + head + rows.map(row => '<tr>' + row.map(cell => '<td><pre>' + esc(cell) + '</pre></td>').join("") + '</tr>').join("") + '</table>';
      }
      function render() {
        const run = selected();
        root.innerHTML = viewKind === "schema" ? schemaView(run) : viewKind === "deadletters" ? deadletterView(run) : (isModelRun(run) ? modelRunView(run) : syncRunView(run));
      }
      window.addEventListener("message", event => {
        if (event.data && event.data.type === "observability") {
          state = event.data;
          render();
        }
      });
      root.addEventListener("click", event => {
        const tab = event.target.closest("button[data-metric]");
        if (!tab) { return; }
        metricMode = tab.dataset.metric || "rows";
        render();
      });
    })();
  </script>
</body>
</html>`;
}

/** Webview body for the Run sidebar status/history panel. */

export function renderSkipprRunStatusPanelHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family); }
    .section-title { height: 22px; padding: 0 8px; display: flex; align-items: center; border-top: 1px solid var(--vscode-panel-border); border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
    .summary { padding: 7px 8px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .line { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 18px; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .status-badge { flex-shrink: 0; display: inline-flex; align-items: center; min-height: 16px; padding: 0 5px; border: 1px solid var(--vscode-panel-border); font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
    .status-badge.running { color: var(--vscode-textLink-foreground); border-color: var(--vscode-textLink-foreground); }
    .status-badge.success { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); }
    .status-badge.error { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
    .status-badge.stopped { color: var(--vscode-editorWarning-foreground); border-color: var(--vscode-editorWarning-foreground); }
    .status-badge.idle { color: var(--vscode-descriptionForeground); }
    .meta { margin-top: 2px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
    .kv { display: grid; grid-template-columns: 86px 1fr; gap: 4px 8px; margin-top: 7px; font-size: 11px; }
    .key { color: var(--vscode-descriptionForeground); }
    .value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model-list { margin-top: 7px; display: flex; flex-direction: column; gap: 3px; }
    .model-file { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-ok { color: var(--vscode-testing-iconPassed); }
    .status-bad { color: var(--vscode-errorForeground); }
    button.run { all: unset; box-sizing: border-box; width: 100%; min-height: 30px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
    button.run:hover { background: var(--vscode-list-hoverBackground); }
    .empty { padding: 8px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const root = document.getElementById("root");
      let showingObservedRun = false;
      function esc(v) {
        return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
      }
      function num(v) {
        return typeof v === "number" ? v.toLocaleString() : "0";
      }
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
      function runName(run) {
        return run.pipeline || run.label || "Skippr run";
      }
      function isModelRun(run) {
        const kind = String((run && (run.runKind || run.command)) || "");
        return kind === "model" || kind.startsWith("model");
      }
      function statusLabel(status) {
        switch (status) {
          case "running": return "Running";
          case "success": return "Success";
          case "error": return "Failed";
          case "stopped": return "Stopped";
          case "idle": return "Idle";
          default: return status ? String(status) : "Idle";
        }
      }
      function statusBadge(status) {
        const value = status || "idle";
        return '<span class="status-badge ' + esc(value) + '">' + esc(statusLabel(value)) + '</span>';
      }
      function runMeta(run) {
        if (isModelRun(run)) {
          const files = modelFileCount(run);
          const preflight = run.modelPreflight ? (run.modelPreflight.ok ? "dbt ok" : "dbt blocked") : "dbt pending";
          const phase = run.phase || currentModelPhaseFromEvents(run) || "starting";
          return esc([duration(run), phase, preflight, "files " + files].join(" · "));
        }
        const parts = [duration(run), "rows " + num(run.totalRows != null ? run.totalRows : run.rowsWritten)];
        return esc(parts.join(" · "));
      }
      function modelRunDetails(run) {
        const pre = run.modelPreflight || {};
        const preStatus = pre.ok === true ? '<span class="status-ok">ok</span>' : pre.ok === false ? '<span class="status-bad">failed</span>' : 'pending';
        const validation = run.modelValidation || {};
        const valStatus = validation.ok === true ? '<span class="status-ok">ok</span>' : validation.ok === false ? '<span class="status-bad">failed</span>' : 'not run';
        const phase = run.phase || currentModelPhaseFromEvents(run) || "starting";
        const repair = run.modelRepairStatus || "none";
        const revision = run.modelPendingPlanRevision ? "pending" : "none";
        const files = (run.modelChangedFiles || []).slice(0, 8).map(file => {
          const label = file.path || file.absolute_path || "changed file";
          const kind = file.change_kind ? " [" + file.change_kind + "]" : "";
          return '<div class="model-file">' + esc(label + kind) + '</div>';
        }).join("");
        return '<div class="kv">' +
          '<div class="key">Phase</div><div class="value">' + esc(phase) + '</div>' +
          '<div class="key">Repair</div><div class="value">' + esc(repair) + '</div>' +
          '<div class="key">Plan</div><div class="value">' + esc(revision) + '</div>' +
          '<div class="key">dbt</div><div class="value">' + preStatus + (pre.command ? ' · ' + esc(pre.command) : '') + '</div>' +
          '<div class="key">Validation</div><div class="value">' + valStatus + (validation.message ? ' · ' + esc(validation.message) : '') + '</div>' +
          (pre.remediation ? '<div class="key">Fix</div><div class="value" title="' + esc(pre.remediation) + '">' + esc(pre.remediation) + '</div>' : '') +
        '</div>' + (files ? '<div class="model-list">' + files + '</div>' : '');
      }
      function currentModelPhaseFromEvents(run) {
        const events = run.events || [];
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].phase) { return events[i].phase; }
        }
        return "";
      }
      function modelFileCount(run) {
        const summary = run.modelFileSummary || {};
        return Number(summary.total_count || (run.modelChangedFiles || []).length || 0);
      }
      function renderCurrent(run) {
        if (!run) {
          return '<div class="section-title">Current Run</div><div class="empty">No active Skippr run.</div>';
        }
        return '<div class="section-title">Current Run</div><div class="summary">' +
          '<div class="line"><span class="name">' + esc(runName(run)) + '</span>' + statusBadge(run.status) + '</div>' +
          '<div class="meta">' + runMeta(run) + '</div>' +
          (isModelRun(run) ? modelRunDetails(run) : '') +
        '</div>';
      }
      function renderHistory(history) {
        const rows = (history || []).map(run =>
          '<button class="run" data-run-id="' + esc(run.id) + '"><div class="line"><span class="name">' + esc(runName(run)) + '</span>' + statusBadge(run.status) + '</div>' +
          '<div class="meta">' + runMeta(run) + '</div></button>'
        ).join("");
        return '<div class="section-title">Previous Runs</div>' + (rows || '<div class="empty">No saved runs yet.</div>');
      }
      function render(m) {
        if (m.type === "status") {
          if (showingObservedRun && (!m.phase || m.phase === "idle")) {
            return;
          }
          showingObservedRun = false;
          root.innerHTML = '<div class="section-title">Current Run</div><div class="summary"><div class="line"><span class="name">' + esc(m.headline || "No Skippr run yet.") + '</span>' + statusBadge(m.phase || "idle") + '</div><div class="meta">' + esc(m.detail || "") + '</div></div>';
          return;
        }
        if (m.type === "observability") {
          showingObservedRun = Boolean(m.current);
          root.innerHTML = renderCurrent(m.current) + renderHistory(m.history);
        }
      }
      root.addEventListener("click", event => {
        const button = event.target.closest("button[data-run-id]");
        if (button) {
          vscode.postMessage({ command: "openRun", runId: button.dataset.runId });
        }
      });
      window.addEventListener("message", function (e) {
        var d = e.data;
        if (d && (d.type === "status" || d.type === "observability")) { render(d); }
      });
    })();
  </script>
</body>
</html>`;
}

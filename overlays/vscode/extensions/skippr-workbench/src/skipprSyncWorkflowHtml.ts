export function renderSkipprSyncWorkflowHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family); }
    .toolbar { display: flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 8px; border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border)); flex-wrap: wrap; }
    .toolbar strong { font-weight: 600; }
    .spacer { flex: 1; }
    select, button { font: inherit; }
    select { max-width: 160px; padding: 2px 4px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
    button { all: unset; box-sizing: border-box; padding: 3px 7px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius: 3px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .content { padding: 8px; }
    .section-title { margin: 8px 0 6px; color: var(--vscode-descriptionForeground); text-transform: uppercase; font-size: 10px; letter-spacing: .05em; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 5px; margin-bottom: 8px; padding: 8px; background: var(--vscode-editorWidget-background); }
    .meta { color: var(--vscode-descriptionForeground); margin-top: 4px; line-height: 1.4; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .spark { display: flex; align-items: flex-end; gap: 2px; height: 48px; margin-top: 8px; }
    .bar { flex: 1; min-width: 4px; background: var(--vscode-charts-blue); min-height: 3px; }
    .empty, .error, .loading { padding: 14px 8px; color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
    .badge { font-size: 10px; text-transform: uppercase; }
  </style>
</head>
<body>
  <main id="root"></main>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const root = document.getElementById("root");
      let payload = { type: "syncWorkflow", status: "idle", pipelines: [] };

      function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
      function pipelineSelect() {
        const pipelines = Array.isArray(payload.pipelines) ? payload.pipelines : [];
        if (!pipelines.length) return "";
        const selected = payload.selectedPipeline || pipelines[0] || "";
        return '<select data-command="selectPipeline">' + pipelines.map(p =>
          '<option value="' + esc(p) + '"' + (p === selected ? " selected" : "") + '>' + esc(p) + '</option>'
        ).join("") + '</select>';
      }
      function sparkline() {
        const points = Array.isArray(payload.metricPoints) ? payload.metricPoints : [];
        if (!points.length) return "";
        const max = Math.max(1, ...points.map(p => Number(p.rows_written || 0)));
        return '<div class="spark">' + points.map(p => {
          const h = Math.max(3, Math.round((Number(p.rows_written || 0) / max) * 44));
          return '<div class="bar" style="height:' + h + 'px" title="' + esc(p.timestamp) + '"></div>';
        }).join("") + '</div>';
      }
      function runCard(run) {
        if (!run) return '<div class="empty">No sync run yet. Run sync once to populate metrics.</div>';
        const parts = [];
        if (run.rowsWritten != null) parts.push(esc(run.rowsWritten) + ' rows written');
        if (run.totalRows != null) parts.push(esc(run.totalRows) + ' total rows');
        if (run.freshnessIso) parts.push('freshness ' + esc(run.freshnessIso));
        return '<div class="card"><div><strong>' + esc(run.label || run.command) + '</strong> <span class="badge">' + esc(run.status) + '</span></div>' +
          '<div class="meta">' + esc(run.headline || "") + (parts.length ? ' · ' + parts.join(' · ') : '') + '</div>' +
          sparkline() +
          '<div class="actions"><button data-command="runSyncOnce">Sync once</button><button data-command="startSync">Start sync</button>' +
          '<button data-command="openRun" data-run-id="' + esc(run.id) + '">Open run</button>' +
          (payload.hasDeadletters ? '<button data-command="openDeadletters">Deadletters</button>' : '') + '</div></div>';
      }
      function render() {
        if (payload.status === "loading" || payload.status === "idle") {
          root.innerHTML = '<div class="toolbar"><strong>Sync</strong><span class="spacer"></span><button data-command="refresh">Refresh</button></div><div class="loading">Loading pipeline context...</div>';
          return;
        }
        if (payload.status === "error") {
          root.innerHTML = '<div class="toolbar"><strong>Sync</strong><span class="spacer"></span><button data-command="refresh">Refresh</button></div><div class="error">' + esc(payload.error || "Unable to load sync workflow.") + '</div>';
          return;
        }
        if (!payload.configPath) {
          root.innerHTML = '<div class="toolbar"><strong>Sync</strong></div><div class="empty">Open a workspace with skippr.yml to run sync.</div>';
          return;
        }
        root.innerHTML = '<div class="toolbar"><strong>Sync</strong>' + pipelineSelect() + '<span class="spacer"></span><button data-command="refresh">Refresh</button></div>' +
          '<div class="content"><div class="section-title">Latest sync run</div>' + runCard(payload.latestRun) + '</div>';
      }
      root.addEventListener("click", event => {
        const target = event.target && event.target.closest ? event.target.closest("[data-command]") : null;
        if (!target) return;
        const command = target.getAttribute("data-command");
        if (command === "selectPipeline") return;
        vscode.postMessage({ command, pipeline: payload.selectedPipeline, runId: target.getAttribute("data-run-id") || undefined });
      });
      root.addEventListener("change", event => {
        const target = event.target;
        if (!target || target.getAttribute("data-command") !== "selectPipeline") return;
        vscode.postMessage({ command: "selectPipeline", pipeline: target.value });
      });
      window.addEventListener("message", event => { payload = event.data || payload; render(); });
      render();
      vscode.postMessage({ command: "ready" });
    })();
  </script>
</body>
</html>`;
}

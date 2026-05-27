export function renderSkipprDiscoverWorkflowHtml(): string {
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
    .row { display: grid; grid-template-columns: 1fr auto; gap: 4px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .empty, .error, .loading { padding: 14px 8px; color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
    .badge { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  </style>
</head>
<body>
  <main id="root"></main>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const root = document.getElementById("root");
      let payload = { type: "discoverWorkflow", status: "idle", pipelines: [] };

      function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
      function pipelineSelect() {
        const pipelines = Array.isArray(payload.pipelines) ? payload.pipelines : [];
        if (!pipelines.length) return "";
        const selected = payload.selectedPipeline || pipelines[0] || "";
        return '<select data-command="selectPipeline">' + pipelines.map(p =>
          '<option value="' + esc(p) + '"' + (p === selected ? " selected" : "") + '>' + esc(p) + '</option>'
        ).join("") + '</select>';
      }
      function runCard(run) {
        if (!run) return '<div class="empty">No discover run yet for this pipeline. Run discover to capture namespaces and schema.</div>';
        return '<div class="card"><div><strong>' + esc(run.label || run.command) + '</strong> <span class="badge">' + esc(run.status) + '</span></div>' +
          '<div class="meta">' + esc(run.headline || "") + (run.namespaceCount != null ? ' · ' + esc(run.namespaceCount) + ' namespaces' : '') +
          (run.elapsedMs != null ? ' · ' + esc(run.elapsedMs) + ' ms' : '') + '</div>' +
          '<div class="actions"><button data-command="openRun" data-run-id="' + esc(run.id) + '">Open run</button>' +
          '<button data-command="viewSchema" data-run-id="' + esc(run.id) + '">View schema</button></div></div>';
      }
      function namespaces() {
        const rows = Array.isArray(payload.namespaces) ? payload.namespaces : [];
        if (!rows.length) return '<div class="empty">Namespaces appear after a discover run completes.</div>';
        return rows.map(row => '<div class="row"><span>' + esc(row.namespace) + '</span><span class="meta">' + esc(row.fieldCount) + ' fields</span></div>').join("");
      }
      function schemaChanges() {
        const rows = Array.isArray(payload.schemaChanges) ? payload.schemaChanges : [];
        if (!rows.length) return "";
        return '<div class="section-title">Recent schema changes</div>' + rows.map(row =>
          '<div class="row"><span>' + esc(row.namespace) + '</span><span class="meta">' + esc(row.summary) + '</span></div>'
        ).join("");
      }
      function render() {
        if (payload.status === "loading" || payload.status === "idle") {
          root.innerHTML = '<div class="toolbar"><strong>Discover</strong><span class="spacer"></span><button data-command="refresh">Refresh</button></div><div class="loading">Loading pipeline context...</div>';
          return;
        }
        if (payload.status === "error") {
          root.innerHTML = '<div class="toolbar"><strong>Discover</strong><span class="spacer"></span><button data-command="refresh">Refresh</button></div><div class="error">' + esc(payload.error || "Unable to load discover workflow.") + '</div>';
          return;
        }
        if (!payload.configPath) {
          root.innerHTML = '<div class="toolbar"><strong>Discover</strong></div><div class="empty">Open a workspace with skippr.yml to run discover.</div>';
          return;
        }
        root.innerHTML = '<div class="toolbar"><strong>Discover</strong>' + pipelineSelect() + '<span class="spacer"></span>' +
          '<button class="primary" data-command="runDiscover">Run discover</button>' +
          '<button data-command="openLineage">Lineage</button>' +
          '<button data-command="refresh">Refresh</button></div>' +
          '<div class="content"><div class="section-title">Latest run</div>' + runCard(payload.latestRun) +
          '<div class="section-title">Namespaces</div>' + namespaces() + schemaChanges() + '</div>';
      }
      root.addEventListener("click", event => {
        const target = event.target && event.target.closest ? event.target.closest("[data-command]") : null;
        if (!target) return;
        const command = target.getAttribute("data-command");
        if (command === "selectPipeline") return;
        vscode.postMessage({
          command,
          pipeline: payload.selectedPipeline,
          runId: target.getAttribute("data-run-id") || undefined
        });
      });
      root.addEventListener("change", event => {
        const target = event.target;
        if (!target || target.getAttribute("data-command") !== "selectPipeline") return;
        vscode.postMessage({ command: "selectPipeline", pipeline: target.value });
      });
      window.addEventListener("message", event => {
        payload = event.data || payload;
        render();
      });
      render();
      vscode.postMessage({ command: "ready" });
    })();
  </script>
</body>
</html>`;
}

export function renderSkipprModelWorkflowHtml(): string {
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
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 5px; padding: 8px; background: var(--vscode-editorWidget-background); }
    .meta { color: var(--vscode-descriptionForeground); margin-top: 4px; line-height: 1.4; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .hint { padding: 8px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
    .empty, .error, .loading { padding: 14px 8px; color: var(--vscode-descriptionForeground); }
    .badge { font-size: 10px; text-transform: uppercase; }
  </style>
</head>
<body>
  <main id="root"></main>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const root = document.getElementById("root");
      let payload = { type: "modelWorkflow", status: "idle", pipelines: [] };

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
        if (!run) return '<div class="empty">No model run yet. Model runs also appear in Run history.</div>';
        const validation = run.modelValidationOk === true ? "passed" : run.modelValidationOk === false ? "failed" : "n/a";
        return '<div class="card"><div><strong>' + esc(run.label || run.command) + '</strong> <span class="badge">' + esc(run.status) + '</span></div>' +
          '<div class="meta">' + esc(run.phase || run.headline || "") +
          (run.modelChangedCount != null ? ' · ' + esc(run.modelChangedCount) + ' files' : '') +
          ' · validation ' + esc(validation) + '</div>' +
          '<div class="actions"><button class="primary" data-command="runModel">Run model</button>' +
          '<button data-command="openRun" data-run-id="' + esc(run.id) + '">Open run details</button>' +
          '<button data-command="resumeChat">Resume in chat</button></div></div>';
      }
      function render() {
        if (payload.status === "loading" || payload.status === "idle") {
          root.innerHTML = '<div class="toolbar"><strong>Model</strong><span class="spacer"></span><button data-command="refresh">Refresh</button></div><div class="loading">Loading...</div>';
          return;
        }
        if (!payload.configPath) {
          root.innerHTML = '<div class="toolbar"><strong>Model</strong></div><div class="empty">Open a workspace with skippr.yml.</div>';
          return;
        }
        root.innerHTML = '<div class="toolbar"><strong>Model</strong>' + pipelineSelect() + '<span class="spacer"></span><button data-command="refresh">Refresh</button></div>' +
          '<div class="content"><div class="hint">Model authoring runs in Skippr agent chat. Use this view for run observability cross-links.</div>' +
          runCard(payload.latestRun) + '</div>';
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

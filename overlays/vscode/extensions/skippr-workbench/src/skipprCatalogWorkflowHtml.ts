export function renderSkipprCatalogWorkflowHtml(): string {
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
    select, button, input { font: inherit; }
    select, input { padding: 2px 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; }
    input { flex: 1; min-width: 80px; max-width: 140px; }
    button { all: unset; box-sizing: border-box; padding: 3px 7px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius: 3px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .content { padding: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .list, .detail { min-height: 120px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; overflow: auto; }
    .item { padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
    .item:hover, .item.selected { background: var(--vscode-list-hoverBackground); }
    .item.selected { background: var(--vscode-list-activeSelectionBackground); }
    .kind { color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; }
    .field { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .empty, .error, .loading { padding: 14px 8px; color: var(--vscode-descriptionForeground); grid-column: 1 / -1; }
    .error { color: var(--vscode-errorForeground); }
    .detail-head { padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; }
  </style>
</head>
<body>
  <main id="root"></main>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const root = document.getElementById("root");
      let payload = { type: "catalogWorkflow", status: "idle", pipelines: [], nodes: [] };
      let filter = "";

      function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
      function pipelineSelect() {
        const pipelines = Array.isArray(payload.pipelines) ? payload.pipelines : [];
        if (!pipelines.length) return "";
        const selected = payload.selectedPipeline || pipelines[0] || "";
        return '<select data-command="selectPipeline">' + pipelines.map(p =>
          '<option value="' + esc(p) + '"' + (p === selected ? " selected" : "") + '>' + esc(p) + '</option>'
        ).join("") + '</select>';
      }
      function filteredNodes() {
        const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
        const q = filter.trim().toLowerCase();
        if (!q) return nodes;
        return nodes.filter(n => (n.label || "").toLowerCase().includes(q) || (n.datasetId || "").toLowerCase().includes(q));
      }
      function selectedNode() {
        const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
        return nodes.find(n => n.id === payload.selectedNodeId) || nodes[0];
      }
      function nodeList() {
        const nodes = filteredNodes();
        if (payload.lineageStatus === "loading") return '<div class="loading">Loading lineage graph...</div>';
        if (!nodes.length) return '<div class="empty">No catalog datasets yet. Refresh lineage to build the graph.</div>';
        return nodes.map(n => '<div class="item ' + (n.id === (selectedNode() && selectedNode().id) ? 'selected' : '') + '" data-command="selectNode" data-node-id="' + esc(n.id) + '">' +
          '<div>' + esc(n.label) + '</div><div class="kind">' + esc(n.kind) + (n.datasetId ? ' · ' + esc(n.datasetId) : '') + '</div></div>').join("");
      }
      function nodeDetail() {
        const node = selectedNode();
        if (!node) return '<div class="empty">Select a dataset to inspect fields.</div>';
        const fields = Array.isArray(node.fields) ? node.fields : [];
        return '<div class="detail-head">' + esc(node.label) + '<div class="kind">' + esc(node.kind) + '</div></div>' +
          '<div class="actions"><button data-command="openLineage">Open in Lineage</button>' +
          (node.path ? '<button data-command="openFile" data-path="' + esc(node.path) + '">Open file</button>' : '') + '</div>' +
          (fields.length ? fields.map(f => '<div class="field"><span>' + esc(f.name) + '</span><span>' + esc(f.fieldType || "") + '</span></div>').join("") : '<div class="empty">No fields in graph metadata.</div>');
      }
      function render() {
        if (payload.status === "loading" || payload.status === "idle") {
          root.innerHTML = '<div class="toolbar"><strong>Catalog</strong><span class="spacer"></span><button data-command="refresh">Refresh</button></div><div class="loading">Loading...</div>';
          return;
        }
        if (payload.status === "error") {
          root.innerHTML = '<div class="toolbar"><strong>Catalog</strong></div><div class="error">' + esc(payload.error || payload.lineageError || "Catalog unavailable.") + '</div>';
          return;
        }
        if (!payload.configPath) {
          root.innerHTML = '<div class="toolbar"><strong>Catalog</strong></div><div class="empty">Open a workspace with skippr.yml.</div>';
          return;
        }
        root.innerHTML = '<div class="toolbar"><strong>Catalog</strong>' + pipelineSelect() +
          '<input type="search" placeholder="Filter datasets" data-command="filter" value="' + esc(filter) + '" />' +
          '<button data-command="refreshLineage">Refresh lineage</button><button data-command="refresh">Refresh</button></div>' +
          '<div class="content"><div class="list">' + nodeList() + '</div><div class="detail">' + nodeDetail() + '</div></div>';
        const input = root.querySelector('input[data-command="filter"]');
        if (input) input.addEventListener("input", e => { filter = e.target.value; render(); });
      }
      root.addEventListener("click", event => {
        const target = event.target && event.target.closest ? event.target.closest("[data-command]") : null;
        if (!target) return;
        const command = target.getAttribute("data-command");
        if (command === "filter" || command === "selectPipeline") return;
        vscode.postMessage({
          command,
          pipeline: payload.selectedPipeline,
          nodeId: target.getAttribute("data-node-id") || payload.selectedNodeId,
          path: target.getAttribute("data-path") || undefined
        });
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

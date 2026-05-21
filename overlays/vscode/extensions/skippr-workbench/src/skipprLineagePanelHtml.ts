export interface SkipprLineagePanelPayload {
  type: "lineage";
  status: "idle" | "running" | "success" | "error";
  pipeline?: string;
  graph?: {
    nodes?: Array<{
      id: string;
      label: string;
      kind: string;
      dataset_id?: string;
      field?: { dataset_id?: string; field_path?: string; field_id?: number };
      path?: string;
      metadata?: Record<string, string>;
    }>;
    edges?: Array<{
      id: string;
      from_node_id: string;
      to_node_id: string;
      kind: string;
      provenance?: { source?: string; status?: string; confidence?: number; source_ref?: string };
      metadata?: Record<string, string>;
    }>;
    diagnostics?: Array<{ severity?: string; message?: string; source?: string }>;
  };
  error?: string;
}

export function renderSkipprLineagePanelHtml(options?: { cspSource?: string; brandLogoUris?: Record<string, string> }): string {
  const cspSource = options?.cspSource || "";
  const brandLogoUris = JSON.stringify(options?.brandLogoUris || {}).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 12px var(--vscode-font-family); }
    .toolbar { height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .toolbar strong { font-weight: 600; }
    .spacer { flex: 1; }
    button { all: unset; box-sizing: border-box; padding: 3px 8px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius: 3px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:disabled { opacity: .45; cursor: default; }
    .badge { display: inline-flex; align-items: center; min-height: 18px; padding: 0 6px; border: 1px solid var(--vscode-panel-border); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .badge.running { color: var(--vscode-textLink-foreground); border-color: var(--vscode-textLink-foreground); }
    .badge.success { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); }
    .badge.error { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
    .muted { color: var(--vscode-descriptionForeground); }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; min-height: calc(100vh - 35px); }
    .graph {
      position: relative;
      overflow: auto;
      min-height: calc(100vh - 35px);
      background-color: #2e2e2e;
      background-image: radial-gradient(circle, #808080 1px, transparent 1px);
      background-size: 16px 16px;
      cursor: grab;
    }
    .graph.dragging { cursor: grabbing; }
    svg { display: block; min-width: 900px; min-height: 560px; }
    .node { cursor: pointer; }
    .node rect { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-panel-border); }
    .node:hover rect, .node.active rect { stroke: var(--vscode-textLink-foreground); stroke-width: 2; }
    .node.highlighted rect { stroke: var(--vscode-textLink-foreground); stroke-width: 2; }
    .node.faded { opacity: .28; }
    .node text { fill: var(--vscode-foreground); font-size: 12px; pointer-events: none; }
    .node .kind { fill: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; }
    .node .brand-badge { fill: var(--vscode-editor-background); stroke: var(--vscode-panel-border); }
    .node .brand { pointer-events: none; }
    .node .brand-fallback { fill: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 700; text-anchor: middle; dominant-baseline: central; }
    .edge { stroke: var(--vscode-descriptionForeground); stroke-width: 1.3; fill: none; opacity: .75; }
    .edge.highlighted { stroke-width: 2; opacity: .95; }
    .edge.faded { opacity: .15; }
    .edge.field_derives_from, .edge.aggregates_from { stroke: var(--vscode-charts-purple); }
    .edge.feeds { stroke: var(--vscode-charts-green); }
    aside { border-left: 1px solid var(--vscode-panel-border); overflow: auto; }
    .section-title { height: 24px; display: flex; align-items: center; padding: 0 10px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
    .detail { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); line-height: 1.45; }
    .kv { display: grid; grid-template-columns: 82px 1fr; gap: 4px 8px; }
    .key { color: var(--vscode-descriptionForeground); }
    .value { overflow-wrap: anywhere; }
    .diag { padding: 7px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .diag.warning { color: var(--vscode-editorWarning-foreground); }
    .diag.error { color: var(--vscode-errorForeground); }
    .empty, .error { padding: 14px 12px; color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <main id="root"></main>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const root = document.getElementById("root");
      const brandLogoUris = ${brandLogoUris};
      let payload = { type: "lineage", status: "idle" };
      let selectedId = "";
      let dragState = null;
      let suppressNextClick = false;
      function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
      function labelKind(kind) { return String(kind || "").replace(/_/g, " "); }
      function nodeRank(node) {
        const raw = node && node.metadata && node.metadata._lineage_rank;
        const parsed = Number.parseInt(String(raw == null ? "" : raw), 10);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      function lineageState(item) {
        return String((item && item.metadata && item.metadata._lineage_state) || "normal");
      }
      function providerBrand(node) {
        return String((node && node.metadata && node.metadata.provider_brand) || "").toLowerCase();
      }
      function providerLabel(node) {
        return String((node && node.metadata && (node.metadata.provider_label || node.metadata.provider_brand)) || "");
      }
      function brandHtml(node) {
        const brand = providerBrand(node);
        if (!brand) { return ""; }
        const href = brandLogoUris[brand] || "";
        const title = providerLabel(node);
        const fallback = brand.slice(0, 2).toUpperCase();
        return '<g class="brand" transform="translate(-18,24)"><title>' + esc(title || brand) + '</title><circle class="brand-badge" cx="0" cy="0" r="16"></circle>' +
          (href ? '<image href="' + esc(href) + '" x="-11" y="-11" width="22" height="22" preserveAspectRatio="xMidYMid meet"></image>' : '<text class="brand-fallback" x="0" y="0">' + esc(fallback) + '</text>') +
        '</g>';
      }
      function nodeColumns(nodes) {
        const groups = new Map();
        for (const node of nodes) {
          const key = nodeRank(node);
          if (!groups.has(key)) { groups.set(key, []); }
          groups.get(key).push(node);
        }
        return Array.from(groups.keys()).sort((a, b) => a - b).map(rank => [rank, groups.get(rank)]);
      }
      function layout(nodes) {
        const cols = nodeColumns(nodes);
        const positions = new Map();
        const width = Math.max(900, cols.length * 210 + 80);
        let height = 560;
        cols.forEach(([rank, items], colIdx) => {
          items.sort((a, b) => String(a.label).localeCompare(String(b.label)));
          height = Math.max(height, items.length * 78 + 80);
          items.forEach((node, rowIdx) => positions.set(node.id, { x: 64 + colIdx * 210, y: 42 + rowIdx * 78, node }));
        });
        return { positions, width, height };
      }
      function edgePath(a, b) {
        const x1 = a.x + 160, y1 = a.y + 24, x2 = b.x, y2 = b.y + 24;
        const mid = Math.max(35, Math.abs(x2 - x1) / 2);
        return "M" + x1 + "," + y1 + " C" + (x1 + mid) + "," + y1 + " " + (x2 - mid) + "," + y2 + " " + x2 + "," + y2;
      }
      function graphHtml(graph) {
        const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
        const edges = Array.isArray(graph && graph.edges) ? graph.edges : [];
        if (!nodes.length) { return '<div class="empty">No lineage graph has been built yet. Run Refresh to build it.</div>'; }
        const laid = layout(nodes);
        const edgeHtml = edges.map(edge => {
          const a = laid.positions.get(edge.from_node_id);
          const b = laid.positions.get(edge.to_node_id);
          if (!a || !b) { return ""; }
          return '<path class="edge ' + esc(edge.kind) + ' ' + esc(lineageState(edge)) + '" d="' + edgePath(a, b) + '"><title>' + esc(edge.kind + " · " + ((edge.provenance && edge.provenance.source) || "")) + '</title></path>';
        }).join("");
        const nodeHtml = Array.from(laid.positions.values()).map(pos => {
          const node = pos.node;
          const active = node.id === selectedId ? " active" : "";
          return '<g class="node ' + esc(lineageState(node)) + active + '" data-node-id="' + esc(node.id) + '" transform="translate(' + pos.x + ',' + pos.y + ')">' +
            '<rect width="160" height="48" rx="6"></rect>' +
            '<text x="8" y="18">' + esc(String(node.label || node.id).slice(0, 24)) + '</text>' +
            '<text class="kind" x="8" y="36">' + esc(labelKind(node.kind)) + '</text>' +
            brandHtml(node) +
          '</g>';
        }).join("");
        return '<svg viewBox="0 0 ' + laid.width + ' ' + laid.height + '" width="' + laid.width + '" height="' + laid.height + '">' + edgeHtml + nodeHtml + '</svg>';
      }
      function selectedNode(graph) {
        const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
        return nodes.find(node => node.id === selectedId) || nodes[0];
      }
      function detailHtml(graph) {
        const node = selectedNode(graph);
        if (!node) { return '<div class="detail muted">Select a node to inspect details.</div>'; }
        selectedId = selectedId || node.id;
        const metadata = node.metadata || {};
        const metaRows = Object.keys(metadata).map(key => '<div class="key">' + esc(key) + '</div><div class="value">' + esc(metadata[key]) + '</div>').join("");
        return '<div class="section-title">Selected</div><div class="detail"><div class="kv">' +
          '<div class="key">Label</div><div class="value">' + esc(node.label) + '</div>' +
          '<div class="key">Kind</div><div class="value">' + esc(labelKind(node.kind)) + '</div>' +
          '<div class="key">ID</div><div class="value">' + esc(node.id) + '</div>' +
          (node.dataset_id ? '<div class="key">Dataset</div><div class="value">' + esc(node.dataset_id) + '</div>' : '') +
          (node.path ? '<div class="key">Path</div><div class="value">' + esc(node.path) + '</div>' : '') +
          metaRows +
        '</div></div>';
      }
      function diagnosticsHtml(graph) {
        const diagnostics = Array.isArray(graph && graph.diagnostics) ? graph.diagnostics : [];
        return '<div class="section-title">Diagnostics</div>' + (diagnostics.length ? diagnostics.map(d => '<div class="diag ' + esc(d.severity || "") + '">' + esc(d.message || "") + (d.source ? '<br><span class="muted">' + esc(d.source) + '</span>' : '') + '</div>').join("") : '<div class="detail muted">No diagnostics.</div>');
      }
      function render() {
        const previousGraph = root.querySelector(".graph");
        const previousScroll = previousGraph ? { left: previousGraph.scrollLeft, top: previousGraph.scrollTop } : undefined;
        const status = payload.status || "idle";
        const graph = payload.graph || {};
        const nodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
        const edges = Array.isArray(graph.edges) ? graph.edges.length : 0;
        const toolbar = '<div class="toolbar"><strong>Lineage</strong><span class="badge ' + esc(status) + '">' + esc(status) + '</span><span class="muted">' + esc(payload.pipeline || "") + '</span><span class="muted">' + nodes + ' nodes · ' + edges + ' edges</span><span class="spacer"></span><button data-action="refresh" ' + (status === "running" ? "disabled" : "") + '>Refresh</button><button data-action="importHistory" ' + (status === "running" ? "disabled" : "") + '>Import Query History</button></div>';
        if (status === "error") {
          root.innerHTML = toolbar + '<div class="error">' + esc(payload.error || "Lineage failed") + '</div>';
          return;
        }
        root.innerHTML = toolbar + '<div class="layout"><section class="graph">' + graphHtml(graph) + '</section><aside>' + detailHtml(graph) + diagnosticsHtml(graph) + '</aside></div>';
        if (previousScroll) {
          const nextGraph = root.querySelector(".graph");
          if (nextGraph) {
            nextGraph.scrollLeft = previousScroll.left;
            nextGraph.scrollTop = previousScroll.top;
          }
        }
      }
      root.addEventListener("click", event => {
        if (suppressNextClick) {
          suppressNextClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const actionButton = target && target.closest("button[data-action]");
        if (actionButton) {
          vscode.postMessage({ command: actionButton.getAttribute("data-action") });
          return;
        }
        const node = target && target.closest(".node[data-node-id]");
        if (node) {
          event.preventDefault();
          selectedId = node.getAttribute("data-node-id") || "";
          render();
        }
      });
      root.addEventListener("pointerdown", event => {
        const graph = event.target instanceof Element ? event.target.closest(".graph") : null;
        if (!graph || event.button !== 0) { return; }
        dragState = {
          graph,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          scrollLeft: graph.scrollLeft,
          scrollTop: graph.scrollTop,
          moved: false
        };
        graph.setPointerCapture(event.pointerId);
      });
      root.addEventListener("pointermove", event => {
        if (!dragState || dragState.pointerId !== event.pointerId) { return; }
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) < 4) { return; }
        dragState.moved = true;
        dragState.graph.classList.add("dragging");
        dragState.graph.scrollLeft = dragState.scrollLeft - dx;
        dragState.graph.scrollTop = dragState.scrollTop - dy;
        event.preventDefault();
      });
      function finishDrag(event) {
        if (!dragState || dragState.pointerId !== event.pointerId) { return; }
        suppressNextClick = dragState.moved;
        dragState.graph.classList.remove("dragging");
        try { dragState.graph.releasePointerCapture(event.pointerId); } catch {}
        dragState = null;
      }
      root.addEventListener("pointerup", finishDrag);
      root.addEventListener("pointercancel", finishDrag);
      window.addEventListener("message", event => {
        if (event.data && event.data.type === "lineage") {
          payload = event.data;
          render();
        }
      });
      render();
    })();
  </script>
</body>
</html>`;
}

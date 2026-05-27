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
  loadingField?: { fieldNodeId: string };
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
    .loading { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: calc(100vh - 35px); color: var(--vscode-descriptionForeground); }
    .spinner { width: 18px; height: 18px; border: 2px solid color-mix(in srgb, var(--vscode-descriptionForeground) 35%, transparent); border-top-color: var(--vscode-textLink-foreground); border-radius: 50%; animation: lineageSpin .8s linear infinite; }
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
    .graph-shell { position: relative; min-height: calc(100vh - 35px); }
    .graph-shell.loading .graph { opacity: .38; pointer-events: none; }
    .graph-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; background: color-mix(in srgb, var(--vscode-editor-background) 48%, transparent); color: var(--vscode-foreground); z-index: 2; }
    svg { display: block; min-width: 900px; min-height: 560px; }
    .node { cursor: pointer; }
    .node rect { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-panel-border); }
    .node:hover rect, .node.active rect { stroke: var(--vscode-textLink-foreground); stroke-width: 2; }
    .node.highlighted rect { stroke: var(--vscode-textLink-foreground); stroke-width: 2; }
    .node.faded { opacity: .28; }
    .node text { fill: var(--vscode-foreground); font-size: 12px; pointer-events: none; }
    .node .kind { fill: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; }
    .node .brand-badge { fill: var(--vscode-editor-background); stroke: var(--vscode-panel-border); }
    .node .brand-badge.brand-skippr { fill: rgb(255, 0, 102); stroke: rgb(255, 0, 102); }
    .node .brand { pointer-events: none; }
    .node .brand-fallback { fill: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 700; text-anchor: middle; dominant-baseline: central; }
    .node .brand-fallback.brand-skippr { fill: #fff; font-size: 17px; font-weight: 800; }
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
    .schema-list { padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .schema-loading { display: flex; align-items: center; gap: 8px; padding: 10px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .schema-row { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 10px; cursor: pointer; color: var(--vscode-foreground); }
    .schema-row:hover { background: var(--vscode-list-hoverBackground); }
    .schema-row.highlighted { color: var(--vscode-textLink-foreground); font-weight: 600; animation: lineagePulse 1.35s ease-in-out infinite; }
    .schema-row.faded { opacity: .45; }
    .schema-leaf { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .schema-path { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .schema-type { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 10px; white-space: nowrap; }
    .actions-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .actions-row select { flex: 1; min-width: 0; padding: 3px 6px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; color: var(--vscode-foreground); background: var(--vscode-input-background); }
    .diag { padding: 7px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .diag.warning { color: var(--vscode-editorWarning-foreground); }
    .diag.error { color: var(--vscode-errorForeground); }
    .empty, .error { padding: 14px 12px; color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
    @keyframes lineagePulse {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.55); }
    }
    @keyframes lineageSpin { to { transform: rotate(360deg); } }
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
      let lastGraph = {};
      let dragState = null;
      let suppressNextClick = false;
      let fieldFocusActive = false;
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
      function isFieldNode(node) {
        return String(node && node.kind || "") === "field";
      }
      function parseLineageResources(metadata) {
        const raw = metadata && metadata.lineage_resources ? String(metadata.lineage_resources).trim() : "";
        if (!raw) { return []; }
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      function schemaFieldsForNode(node, graph) {
        if (!node) { return []; }
        const edges = Array.isArray(graph && graph.edges) ? graph.edges : [];
        const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
        const fieldNodeIds = edges
          .filter(edge => edge.kind === "contains_field" && edge.from_node_id === node.id)
          .map(edge => edge.to_node_id);
        return fieldNodeIds
          .map(fieldNodeId => nodes.find(item => item.id === fieldNodeId))
          .filter(item => item && isFieldNode(item))
          .map(item => ({
            fieldPath: String(item.field && item.field.field_path || item.label || item.id),
            fieldNodeId: item.id,
            fieldType: String((item.metadata && item.metadata.type) || "").trim(),
            nullable: item.metadata && item.metadata.nullable === "true" ? true : item.metadata && item.metadata.nullable === "false" ? false : undefined,
            state: lineageState(item)
          }))
          .filter(field => field.fieldPath)
          .sort((a, b) => a.fieldPath.localeCompare(b.fieldPath));
      }
      const RESOURCE_ACTION_BY_KIND = {
        metadata: "openMetadata",
        config: "openConfig",
        source_file: "openFile",
        storage_location: "openMetadata",
        dataset_id: "copyDatasetId",
        node_id: "copyNodeId"
      };
      function lineageActionsForNode(node) {
        if (!node) { return []; }
        const resources = parseLineageResources(node.metadata);
        const actions = resources
          .map(resource => RESOURCE_ACTION_BY_KIND[String(resource.kind || "").toLowerCase()])
          .filter(Boolean);
        return [...new Set(actions)];
      }
      function lineageActionLabel(action) {
        switch (action) {
          case "openFile": return "Open file";
          case "openMetadata": return "Open metadata";
          case "openConfig": return "Open skippr.yml";
          case "copyNodeId": return "Copy node id";
          case "copyDatasetId": return "Copy dataset id";
          default: return action;
        }
      }
      function displayedGraphNodes(nodes) {
        return nodes.filter(node => !isFieldNode(node));
      }
      function nodeFields(node, graph) {
        if (!node) { return []; }
        const edges = Array.isArray(graph && graph.edges) ? graph.edges : [];
        const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
        return edges
          .filter(edge => edge.kind === "contains_field" && edge.from_node_id === node.id)
          .map(edge => nodes.find(item => item.id === edge.to_node_id))
          .filter(item => item && isFieldNode(item))
          .sort((a, b) => String(a.field && a.field.field_path || "").localeCompare(String(b.field && b.field.field_path || "")));
      }
      const ENTITY_NODE_HEIGHT = 48;
      function nodeState(node, fields) {
        if (fields.some(field => lineageState(field) === "highlighted")) { return "highlighted"; }
        return lineageState(node);
      }
      function brandHtml(node) {
        const brand = providerBrand(node);
        if (!brand) { return ""; }
        const href = brandLogoUris[brand] || "";
        const title = providerLabel(node);
        const fallback = brand === "skippr" ? "S" : brand.slice(0, 2).toUpperCase();
        return '<g class="brand" transform="translate(-18,24)"><title>' + esc(title || brand) + '</title><circle class="brand-badge brand-' + esc(brand) + '" cx="0" cy="0" r="16"></circle>' +
          (href ? '<image href="' + esc(href) + '" x="-11" y="-11" width="22" height="22" preserveAspectRatio="xMidYMid meet"></image>' : '<text class="brand-fallback brand-' + esc(brand) + '" x="0" y="0">' + esc(fallback) + '</text>') +
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
      function layout(nodes, graph) {
        const cols = nodeColumns(nodes);
        const positions = new Map();
        const width = Math.max(900, cols.length * 210 + 80);
        let height = 560;
        cols.forEach(([rank, items], colIdx) => {
          items.sort((a, b) => String(a.label).localeCompare(String(b.label)));
          let y = 42;
          items.forEach(node => {
            const fields = nodeFields(node, graph);
            positions.set(node.id, { x: 64 + colIdx * 210, y, node, fields, height: ENTITY_NODE_HEIGHT });
            y += boxHeight + 30;
          });
          height = Math.max(height, y + 40);
        });
        return { positions, width, height };
      }
      function edgePath(a, b) {
        const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
        const mid = Math.max(35, Math.abs(x2 - x1) / 2);
        return "M" + x1 + "," + y1 + " C" + (x1 + mid) + "," + y1 + " " + (x2 - mid) + "," + y2 + " " + x2 + "," + y2;
      }
      function anchorFor(id, laid, fieldPositions, side) {
        const field = fieldPositions.get(id);
        if (field) {
          return side === "to" ? { x: field.x, y: field.y } : { x: field.x + 160, y: field.y };
        }
        const pos = laid.positions.get(id);
        if (!pos) { return undefined; }
        return side === "to" ? { x: pos.x, y: pos.y + 24 } : { x: pos.x + 160, y: pos.y + 24 };
      }
      function graphHtml(graph) {
        const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
        const edges = Array.isArray(graph && graph.edges) ? graph.edges : [];
        if (!nodes.length) { return '<div class="empty">No lineage graph has been built yet. Run Refresh to build it.</div>'; }
        const laid = layout(displayedGraphNodes(nodes), graph);
        const fieldPositions = new Map();
        for (const pos of laid.positions.values()) {
          const anchorY = pos.y + 24;
          pos.fields.forEach((field) => fieldPositions.set(field.id, { x: pos.x, y: anchorY }));
        }
        const edgeHtml = edges.map(edge => {
          if (edge.kind === "contains_field") { return ""; }
          const a = anchorFor(edge.from_node_id, laid, fieldPositions, "from");
          const b = anchorFor(edge.to_node_id, laid, fieldPositions, "to");
          if (!a || !b) { return ""; }
          return '<path class="edge ' + esc(edge.kind) + ' ' + esc(lineageState(edge)) + '" d="' + edgePath(a, b) + '"><title>' + esc(edge.kind + " · " + ((edge.provenance && edge.provenance.source) || "")) + '</title></path>';
        }).join("");
        const nodeHtml = Array.from(laid.positions.values()).map(pos => {
          const node = pos.node;
          const active = node.id === selectedId ? " active" : "";
          const state = nodeState(node, pos.fields);
          return '<g class="node ' + esc(state) + active + '" data-node-id="' + esc(node.id) + '" transform="translate(' + pos.x + ',' + pos.y + ')">' +
            '<rect width="160" height="' + pos.height + '" rx="6"></rect>' +
            '<text x="8" y="18">' + esc(String(node.label || node.id).slice(0, 24)) + '</text>' +
            '<text class="kind" x="8" y="36">' + esc(labelKind(node.kind)) + '</text>' +
            brandHtml(node) +
          '</g>';
        }).join("");
        return '<svg viewBox="0 0 ' + laid.width + ' ' + laid.height + '" width="' + laid.width + '" height="' + laid.height + '">' + edgeHtml + nodeHtml + '</svg>';
      }
      function selectedNode(graph) {
        const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
        return nodes.find(node => node.id === selectedId) || displayedGraphNodes(nodes)[0];
      }
      function currentGraph() {
        return payload.graph || lastGraph || {};
      }
      function selectNode(nodeId) {
        if (!nodeId) { return; }
        selectedId = nodeId;
        if (fieldFocusActive) {
          fieldFocusActive = false;
          payload.loadingField = undefined;
          payload.status = "running";
          render();
          vscode.postMessage({ command: "clearField" });
          return;
        }
        postSelectedSchema();
        render();
      }
      function detailHtml(graph) {
        const node = selectedNode(graph);
        if (!node) { return '<div class="detail muted">Select a node to inspect details.</div>'; }
        selectedId = selectedId || node.id;
        const metadata = node.metadata || {};
        const metaRows = Object.keys(metadata).filter(key => key !== "lineage_resources").map(key => '<div class="key">' + esc(key) + '</div><div class="value">' + esc(metadata[key]) + '</div>').join("");
        const actions = lineageActionsForNode(node);
        const actionOptions = actions.map(action => '<option value="' + esc(action) + '">' + esc(lineageActionLabel(action)) + '</option>').join("");
        const actionsRow = actions.length ? '<div class="section-title">Actions</div><div class="actions-row"><select data-action="lineageActionSelect"><option value="">Choose action...</option>' + actionOptions + '</select></div>' : "";
        return '<div class="section-title">Selected</div><div class="detail"><div class="kv">' +
          '<div class="key">Label</div><div class="value">' + esc(node.label) + '</div>' +
          '<div class="key">Kind</div><div class="value">' + esc(labelKind(node.kind)) + '</div>' +
          '<div class="key">ID</div><div class="value">' + esc(node.id) + '</div>' +
          (node.dataset_id ? '<div class="key">Dataset</div><div class="value">' + esc(node.dataset_id) + '</div>' : '') +
          (node.path ? '<div class="key">Path</div><div class="value">' + esc(node.path) + '</div>' : '') +
          metaRows +
        '</div></div>' + actionsRow;
      }
      function schemaRowHtml(field, node) {
        const fieldPath = String(field.fieldPath || "");
        const parts = fieldPath.split(".").filter(Boolean);
        const depth = Math.max(0, parts.length - 1);
        const leaf = parts[parts.length - 1] || fieldPath;
        const typeLabel = field.fieldType ? field.fieldType + (field.nullable === false ? " · required" : field.nullable ? " · nullable" : "") : "";
        const state = field.state || "normal";
        return '<button class="schema-row ' + esc(state) + '" data-action="selectField" data-field-node-id="' + esc(field.fieldNodeId || "") + '" style="padding-left:' + (10 + depth * 14) + 'px">' +
          '<span class="schema-leaf">' + esc(leaf) + '</span>' +
          (typeLabel ? '<span class="schema-type">' + esc(typeLabel) + '</span>' : (depth > 0 ? '<span class="schema-path">' + esc(parts.slice(0, -1).join(".")) + '</span>' : '')) +
        '</button>';
      }
      function schemaHtml(graph) {
        const node = selectedNode(graph);
        if (!node) { return '<div class="section-title">Schema</div><div class="detail muted">Select a node to inspect schema.</div>'; }
        const fields = schemaFieldsForNode(node, graph);
        if (!fields.length) {
          return '<div class="section-title">Schema</div><div class="detail muted">No fields in persisted lineage graph. Run Refresh to rebuild skipprd metadata lineage.</div>';
        }
        const rows = fields.map(field => schemaRowHtml(field, node)).join("");
        return '<div class="section-title">Schema</div><div class="schema-list">' + rows + '</div>';
      }
      function postSelectedSchema() {
        const graph = currentGraph();
        const node = selectedNode(graph);
        const fields = node ? schemaFieldsForNode(node, graph) : [];
        const schema = {
          node: node ? { id: node.id, label: node.label, datasetId: node.dataset_id, kind: node.kind } : undefined,
          fields
        };
        vscode.postMessage({ command: "selectedNode", schema, node: schema.node });
      }
      function diagnosticsHtml(graph) {
        const diagnostics = Array.isArray(graph && graph.diagnostics) ? graph.diagnostics : [];
        return '<div class="section-title">Diagnostics</div>' + (diagnostics.length ? diagnostics.map(d => '<div class="diag ' + esc(d.severity || "") + '">' + esc(d.message || "") + (d.source ? '<br><span class="muted">' + esc(d.source) + '</span>' : '') + '</div>').join("") : '<div class="detail muted">No diagnostics.</div>');
      }
      function render() {
        const previousGraph = root.querySelector(".graph");
        const previousScroll = previousGraph ? { left: previousGraph.scrollLeft, top: previousGraph.scrollTop } : undefined;
        const status = payload.status || "idle";
        const graph = currentGraph();
        if (payload.graph) { lastGraph = payload.graph; }
        const nodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
        const edges = Array.isArray(graph.edges) ? graph.edges.length : 0;
        const running = status === "running" ? '<span class="spinner" aria-label="Loading"></span>' : '';
        const toolbar = '<div class="toolbar"><strong>Lineage</strong>' + running + '<span class="badge ' + esc(status) + '">' + esc(status) + '</span><span class="muted">' + esc(payload.pipeline || "") + '</span><span class="muted">' + nodes + ' nodes · ' + edges + ' edges</span><span class="spacer"></span><button data-action="refresh" ' + (status === "running" ? "disabled" : "") + '>Refresh</button><button data-action="importHistory" ' + (status === "running" ? "disabled" : "") + '>Import Query History</button></div>';
        if (status === "error") {
          root.innerHTML = toolbar + '<div class="error">' + esc(payload.error || "Lineage failed") + '</div>';
          return;
        }
        if (status === "running" && !Array.isArray(graph.nodes)) {
          root.innerHTML = toolbar + '<div class="loading"><span class="spinner"></span><span>Loading lineage graph...</span></div>';
          return;
        }
        const overlay = status === "running" && Array.isArray(graph.nodes) ? '<div class="graph-overlay"><span class="spinner"></span><span>Loading field lineage...</span></div>' : '';
        root.innerHTML = toolbar + '<div class="layout"><section class="graph-shell ' + (overlay ? "loading" : "") + '"><div class="graph">' + graphHtml(graph) + '</div>' + overlay + '</section><aside>' + detailHtml(graph) + schemaHtml(graph) + diagnosticsHtml(graph) + '</aside></div>';
        if (previousScroll) {
          const nextGraph = root.querySelector(".graph");
          if (nextGraph) {
            nextGraph.scrollLeft = previousScroll.left;
            nextGraph.scrollTop = previousScroll.top;
          }
        }
      }
      root.addEventListener("change", event => {
        const target = event.target instanceof Element ? event.target : null;
        const select = target && target.closest("[data-action='lineageActionSelect']");
        if (!select) { return; }
        const action = select.value;
        select.value = "";
        if (!action) { return; }
        const node = selectedNode(currentGraph());
        if (!node) { return; }
        vscode.postMessage({ command: "lineageAction", action, nodeId: node.id });
      });
      root.addEventListener("click", event => {
        if (suppressNextClick) {
          suppressNextClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const actionButton = target && target.closest("[data-action]");
        if (actionButton) {
          const action = actionButton.getAttribute("data-action");
          if (action === "selectField") {
            fieldFocusActive = true;
            const fieldNodeId = actionButton.getAttribute("data-field-node-id") || "";
            if (!fieldNodeId) { return; }
            payload.loadingField = { fieldNodeId };
            payload.status = "running";
            render();
            vscode.postMessage({ command: "selectField", fieldNodeId });
          } else {
            vscode.postMessage({ command: action });
          }
          return;
        }
        const node = target && target.closest(".node[data-node-id]");
        if (node) {
          event.preventDefault();
          selectNode(node.getAttribute("data-node-id") || "");
        }
      });
      root.addEventListener("pointerdown", event => {
        const graph = event.target instanceof Element ? event.target.closest(".graph") : null;
        if (!graph || event.button !== 0) { return; }
        const actionTarget = event.target instanceof Element ? event.target.closest("[data-action]") : null;
        const node = event.target instanceof Element ? event.target.closest(".node[data-node-id]") : null;
        dragState = {
          graph,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          scrollLeft: graph.scrollLeft,
          scrollTop: graph.scrollTop,
          nodeId: !actionTarget && node ? node.getAttribute("data-node-id") || "" : "",
          moved: false
        };
      });
      root.addEventListener("pointermove", event => {
        if (!dragState || dragState.pointerId !== event.pointerId) { return; }
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) < 4) { return; }
        dragState.moved = true;
        dragState.graph.classList.add("dragging");
        try { dragState.graph.setPointerCapture(event.pointerId); } catch {}
        dragState.graph.scrollLeft = dragState.scrollLeft - dx;
        dragState.graph.scrollTop = dragState.scrollTop - dy;
        event.preventDefault();
      });
      function finishDrag(event) {
        if (!dragState || dragState.pointerId !== event.pointerId) { return; }
        const clickedNodeId = !dragState.moved ? dragState.nodeId : "";
        suppressNextClick = dragState.moved;
        dragState.graph.classList.remove("dragging");
        try { dragState.graph.releasePointerCapture(event.pointerId); } catch {}
        dragState = null;
        if (clickedNodeId) {
          event.preventDefault();
          selectNode(clickedNodeId);
        }
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

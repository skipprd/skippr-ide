import type { SkipprConnectionsPanelPayload, SkipprConfigConnection } from "./types";

export function renderSkipprConnectionsPanelHtml(options?: { cspSource?: string; brandLogoUris?: Record<string, string> }): string {
  const cspSource = options?.cspSource || "";
  const brandLogoUris = JSON.stringify(options?.brandLogoUris || {}).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family); }
    .toolbar { display: flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 8px; border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border)); }
    .toolbar strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .spacer { flex: 1; }
    button { all: unset; box-sizing: border-box; padding: 3px 7px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius: 3px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .content { padding: 8px; }
    .section { margin-bottom: 14px; }
    .section-title { margin: 8px 0 6px; color: var(--vscode-descriptionForeground); text-transform: uppercase; font-size: 10px; letter-spacing: .05em; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 5px; margin-bottom: 8px; background: var(--vscode-editorWidget-background); overflow: visible; }
    .head { display: grid; grid-template-columns: 28px 1fr; gap: 8px; align-items: center; padding: 8px; }
    .logo { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editor-background); color: var(--vscode-descriptionForeground); font-weight: 700; font-size: 10px; overflow: hidden; }
    .logo img { max-width: 20px; max-height: 20px; }
    .name { font-weight: 600; overflow-wrap: anywhere; }
    .meta { margin-top: 2px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
    .fields { border-top: 1px solid var(--vscode-panel-border); padding: 6px 8px; }
    .field { display: grid; grid-template-columns: minmax(72px, .8fr) minmax(0, 1fr); gap: 6px; line-height: 1.45; }
    .key { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .value { overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 7px 8px; border-top: 1px solid var(--vscode-panel-border); }
    .dropdown { position: relative; display: inline-flex; }
    .dropdown-trigger::after { content: "⌄"; margin-left: 6px; color: var(--vscode-descriptionForeground); }
    .dropdown-menu { position: absolute; left: 0; top: calc(100% + 3px); z-index: 30; min-width: 180px; max-width: 280px; padding: 4px 0; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 4px; color: var(--vscode-menu-foreground, var(--vscode-foreground)); background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); box-shadow: 0 4px 12px var(--vscode-widget-shadow); }
    .dropdown-item { display: flex; align-items: center; min-height: 24px; padding: 0 24px 0 10px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dropdown-item:hover { color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground)); background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); }
    .empty, .error, .loading { padding: 14px 8px; color: var(--vscode-descriptionForeground); }
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
      let payload = { type: "connections", status: "idle" };
      let openMenu = null;

      function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
      function attr(v) { return esc(v); }
      function brandKey(conn) { return String((conn.provider || conn.label || "").toLowerCase()).replace(/[^a-z0-9]+/g, ""); }
      function initials(conn) {
        const label = String(conn.label || conn.provider || "?").trim();
        return label.split(/\\s+/).map(part => part[0] || "").join("").slice(0, 2).toUpperCase() || "?";
      }
      function logo(conn) {
        const key = brandKey(conn);
        const uri = brandLogoUris[key];
        return uri ? '<span class="logo"><img alt="" src="' + attr(uri) + '"></span>' : '<span class="logo">' + esc(initials(conn)) + '</span>';
      }
      function pipelineText(conn) {
        const pipelines = Array.isArray(conn.pipelines) ? conn.pipelines : [];
        return pipelines.length ? "Pipeline: " + pipelines.join(", ") : "No pipeline references";
      }
      function connectionMeta(conn, kind) {
        const parts = [conn.label || conn.provider || "Unknown", pipelineText(conn)];
        if (kind === "sink" && conn.schema_sink) parts.push("Schema sink: " + conn.schema_sink);
        if (kind === "schema" && Array.isArray(conn.linked_sinks) && conn.linked_sinks.length) parts.push("Used by: " + conn.linked_sinks.join(", "));
        return parts.join(" · ");
      }
      function fields(conn) {
        const fields = Array.isArray(conn.fields) ? conn.fields.slice(0, 8) : [];
        if (!fields.length) return "";
        return '<div class="fields">' + fields.map(field =>
          '<div class="field"><span class="key">' + esc(field.name) + '</span><span class="value">' + esc(field.value) + '</span></div>'
        ).join("") + '</div>';
      }
      function actionButton(label, command, kind, conn) {
        const args = " data-kind=\\"" + attr(kind) + "\\" data-name=\\"" + attr(conn.name) + "\\"";
        return '<button data-command="' + attr(command) + '"' + args + '>' + esc(label) + '</button>';
      }
      function pipelineAction(label, command, kind, conn) {
        const pipelines = Array.isArray(conn.pipelines) ? conn.pipelines : [];
        if (pipelines.length <= 1) return actionButton(label, command, kind, conn);
        const isOpen = openMenu && openMenu.command === command && openMenu.kind === kind && openMenu.name === conn.name;
        return '<span class="dropdown">' +
          '<button class="dropdown-trigger" data-command="togglePipelineMenu" data-action-command="' + attr(command) + '" data-kind="' + attr(kind) + '" data-name="' + attr(conn.name) + '">' + esc(label) + '</button>' +
          (isOpen ? '<div class="dropdown-menu" role="menu">' + pipelines.map(pipeline =>
            '<div class="dropdown-item" role="menuitem" tabindex="0" data-command="' + attr(command) + '" data-kind="' + attr(kind) + '" data-name="' + attr(conn.name) + '" data-pipeline="' + attr(pipeline) + '">' + esc(pipeline) + '</div>'
          ).join("") + '</div>' : "") +
          '</span>';
      }
      function actions(conn, kind) {
        const buttons = [actionButton("Open Config", "openConfig", kind, conn)];
        if (kind === "sink" && conn.supports_sql) buttons.unshift(pipelineAction("Open SQL Query", "openSql", kind, conn));
        if (Array.isArray(conn.pipelines) && conn.pipelines.length) buttons.unshift(pipelineAction("Lineage", "openLineage", kind, conn));
        return '<div class="actions">' + buttons.join("") + '</div>';
      }
      function card(conn, kind) {
        return '<article class="card">' +
          '<div class="head">' + logo(conn) + '<div><div class="name">' + esc(conn.name) + '</div><div class="meta">' + esc(connectionMeta(conn, kind)) + '</div></div></div>' +
          fields(conn) + actions(conn, kind) + '</article>';
      }
      function section(title, items, kind) {
        if (!Array.isArray(items) || !items.length) return '<section class="section"><div class="section-title">' + esc(title) + '</div><div class="empty">None configured.</div></section>';
        return '<section class="section"><div class="section-title">' + esc(title) + '</div>' + items.map(item => card(item, kind)).join("") + '</section>';
      }
      function render() {
        if (payload.status === "loading" || payload.status === "idle") {
          root.innerHTML = '<div class="toolbar"><strong>Connections</strong><span class="spacer"></span><button data-command="refresh">Refresh</button></div><div class="loading">Loading connections...</div>';
          return;
        }
        if (payload.status === "error") {
          root.innerHTML = '<div class="toolbar"><strong>Connections</strong><span class="spacer"></span><button data-command="refresh">Refresh</button></div><div class="error">' + esc(payload.error || "Unable to load connections.") + '</div>';
          return;
        }
        const connections = payload.connections || {};
        root.innerHTML = '<div class="toolbar"><strong>' + esc(payload.workspace || "Connections") + '</strong><span class="spacer"></span><button data-command="refresh">Refresh</button></div>' +
          '<div class="content">' +
          section("Sources", connections.sources, "source") +
          section("Data Sinks", connections.sinks, "sink") +
          section("Schema Sinks", connections.schema_sinks, "schema") +
          '</div>';
      }
      root.addEventListener("click", event => {
        const target = event.target && event.target.closest ? event.target.closest("[data-command]") : null;
        if (!target) {
          openMenu = null;
          render();
          return;
        }
        const command = target.getAttribute("data-command");
        const kind = target.getAttribute("data-kind");
        const name = target.getAttribute("data-name");
        if (command === "togglePipelineMenu") {
          const actionCommand = target.getAttribute("data-action-command");
          openMenu = openMenu && openMenu.command === actionCommand && openMenu.kind === kind && openMenu.name === name ? null : { command: actionCommand, kind, name };
          render();
          return;
        }
        const pipeline = target.getAttribute("data-pipeline");
        openMenu = null;
        vscode.postMessage({
          command,
          kind,
          name,
          pipeline
        });
      });
      root.addEventListener("keydown", event => {
        const item = event.target && event.target.matches && event.target.matches(".dropdown-item[data-command]") ? event.target : null;
        if (!item || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        item.click();
      });
      function findConnection(kind, name) {
        const connections = payload.connections || {};
        const items = kind === "source" ? connections.sources : kind === "sink" ? connections.sinks : kind === "schema" ? connections.schema_sinks : [];
        return Array.isArray(items) ? items.find(item => item.name === name) : null;
      }
      window.addEventListener("message", event => {
        payload = event.data || payload;
        render();
      });
      render();
      vscode.postMessage({ command: "ready" });
    }());
  </script>
</body>
</html>`;
}

export type { SkipprConnectionsPanelPayload, SkipprConfigConnection };

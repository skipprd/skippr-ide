export function renderSkipprSchemaPanelHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family); }
    .empty { padding: 8px; color: var(--vscode-descriptionForeground); }
    .namespace { border-bottom: 1px solid var(--vscode-panel-border); }
    .namespace h3 { margin: 0; height: 24px; padding: 0 8px; display: flex; align-items: center; border-top: 1px solid var(--vscode-panel-border); border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBarSectionHeader-background); color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground)); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .field { display: grid; grid-template-columns: minmax(96px, 1fr) 96px 64px; gap: 6px; min-height: 22px; align-items: center; padding: 0 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .field strong { font-weight: 500; }
    .muted { color: var(--vscode-descriptionForeground); }
    .pulse { animation: pulse 1.4s ease-out 1; }
    @keyframes pulse { from { background: color-mix(in srgb, var(--vscode-textLink-foreground) 14%, transparent); } to { background: transparent; } }
  </style>
</head>
<body>
  <main id="root"><div class="empty">Schema will appear during discover or sync.</div></main>
  <script>
    (function () {
      const root = document.getElementById("root");
      let lastChanged = new Set();
      function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
      function render(state) {
        const run = state.current || state.selected;
        if (!run || !run.schemas || !Object.keys(run.schemas).length) {
          root.innerHTML = '<div class="empty">Schema will appear during discover or sync.</div>';
          return;
        }
        lastChanged = new Set((run.schemaChanges || []).flatMap(change => [
          ...((change.diff && change.diff.added) || []),
          ...((change.diff && change.diff.removed) || []),
          ...((change.diff && change.diff.changed) || []).map(item => item.name)
        ].filter(Boolean)));
        root.innerHTML = Object.entries(run.schemas).sort(([a], [b]) => a.localeCompare(b)).map(([namespace, schema]) => {
          const fields = Array.isArray(schema.fields) ? schema.fields : [];
          return '<section class="namespace"><h3>' + esc(namespace) + '</h3>' +
            fields.map(field => '<div class="field ' + (lastChanged.has(field.name) ? 'pulse' : '') + '"><strong>' + esc(field.name) + '</strong><span>' + esc(field.field_type || "unknown") + '</span><span class="muted">' + (field.nullable === false ? "required" : "nullable") + '</span></div>').join("") +
          '</section>';
        }).join("");
      }
      window.addEventListener("message", event => {
        if (event.data && event.data.type === "observability") {
          render(event.data);
        }
      });
    })();
  </script>
</body>
</html>`;
}

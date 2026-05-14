/** Webview body for the Run Skippr STATUS sidebar panel (last / current run outcome). */

export function renderSkipprRunStatusPanelHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); padding: 10px 12px; margin: 0; border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); }
    .phase { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
    .phase.idle { color: var(--vscode-descriptionForeground); }
    .phase.running { color: var(--vscode-textLink-foreground); }
    .phase.success { color: var(--vscode-testing-iconPassed); }
    .phase.stopped { color: var(--vscode-editorWarning-foreground); }
    .phase.error { color: var(--vscode-errorForeground); }
    .headline { margin: 4px 0 8px; word-break: break-word; }
    .meta { color: var(--vscode-descriptionForeground); line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <div id="phase" class="phase idle">Idle</div>
  <div id="headline" class="headline">No Skippr run yet.</div>
  <div id="meta" class="meta"></div>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const phaseEl = document.getElementById("phase");
      const headlineEl = document.getElementById("headline");
      const metaEl = document.getElementById("meta");
      function render(m) {
        const phase = m.phase || "idle";
        phaseEl.textContent = phase.charAt(0).toUpperCase() + phase.slice(1);
        phaseEl.className = "phase " + phase;
        headlineEl.textContent = m.headline || "";
        const lines = [];
        if (m.detail) { lines.push(m.detail); }
        if (m.startedAt) { lines.push("Started: " + new Date(m.startedAt).toLocaleString()); }
        if (m.finishedAt) { lines.push("Finished: " + new Date(m.finishedAt).toLocaleString()); }
        if (m.exitCode !== undefined && m.exitCode !== null) { lines.push("Exit code: " + m.exitCode); }
        if (m.signal) { lines.push("Signal: " + m.signal); }
        if (m.elapsedMs !== undefined && m.elapsedMs !== null) { lines.push("Duration: " + m.elapsedMs + " ms"); }
        metaEl.textContent = lines.filter(Boolean).join("\\n");
      }
      window.addEventListener("message", function (e) {
        var d = e.data;
        if (d && d.type === "status") { render(d); }
      });
    })();
  </script>
</body>
</html>`;
}

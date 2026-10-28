export type DashboardFormMode = "create" | "addFromTable" | "addFromEditor" | "model";

export const SKIPPR_DASHBOARDS_FORM_VIEW_ID = "skippr.dashboards.form";

export function dashboardFormSetModeMessage(
  mode: DashboardFormMode,
  dashId?: string
): { command: "setMode"; mode: DashboardFormMode; id?: string } {
  const id = dashId?.trim();
  return id ? { command: "setMode", mode, id } : { command: "setMode", mode };
}

export function renderDashboardFormHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-panel-background, var(--vscode-editor-background)); font: 12px var(--vscode-font-family); }
    .wrap { padding: 10px; display: grid; gap: 8px; }
    label { display: grid; gap: 4px; color: var(--vscode-descriptionForeground); }
    input, textarea { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
    textarea { min-height: 64px; }
    button { all: unset; box-sizing: border-box; width: max-content; padding: 4px 10px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius: 3px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .muted { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <form class="wrap" id="form">
    <strong id="title">Dashboard</strong>
    <p class="muted" id="hint">Use the Dashboards toolbar to create or add a widget.</p>
    <label id="idRow">Id<input name="id" placeholder="revenue_overview" /></label>
    <label id="titleRow">Title<input name="title" placeholder="Revenue overview" /></label>
    <label id="pipelineRow">Pipeline<input name="pipeline" placeholder="bike_hire" /></label>
    <label id="tableRow">Table<input name="table" placeholder="schema.table" /></label>
    <label id="goalRow">Modeling goal<textarea name="goal" placeholder="Create a mart for daily revenue by region"></textarea></label>
    <button type="submit" id="submit">Save</button>
  </form>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const form = document.getElementById("form");
      let mode = "";
      function show(id, on) { document.getElementById(id).style.display = on ? "grid" : "none"; }
      function applyMode(next) {
        mode = next || "";
        const titles = { create: "New dashboard", addFromTable: "Add widget from table", addFromEditor: "Add widget from editor", model: "Model for dashboard" };
        document.getElementById("title").textContent = titles[mode] || "Dashboard";
        document.getElementById("hint").textContent = mode ? "" : "Use the Dashboards toolbar to create or add a widget.";
        document.getElementById("submit").style.display = mode ? "block" : "none";
        show("idRow", mode === "create" || mode === "addFromTable" || mode === "addFromEditor");
        show("titleRow", mode === "create");
        show("pipelineRow", mode === "create" || mode === "model");
        show("tableRow", mode === "addFromTable");
        show("goalRow", mode === "model");
      }
      applyMode("");
      window.addEventListener("message", (event) => {
        if (event.data && event.data.command === "setMode") {
          applyMode(event.data.mode);
          const idInput = document.querySelector('input[name="id"]');
          if (idInput && event.data.id) {
            idInput.value = event.data.id;
          }
        }
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!mode) { return; }
        const data = new FormData(form);
        vscode.postMessage({
          command: "submit",
          mode,
          id: String(data.get("id") || "").trim(),
          title: String(data.get("title") || "").trim(),
          pipeline: String(data.get("pipeline") || "").trim(),
          table: String(data.get("table") || "").trim(),
          goal: String(data.get("goal") || "").trim()
        });
      });
      vscode.postMessage({ command: "ready" });
    }());
  </script>
</body>
</html>`;
}

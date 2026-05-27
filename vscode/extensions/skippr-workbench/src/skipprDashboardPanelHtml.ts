import { BUSINESS_LIGHT_THEME_VARS, CHART_PANEL_STYLES, chartScriptBlock } from "./skipprChartRender";

export type DashboardPanelMode = "business" | "engineer";

export function renderDashboardPanelHtml(mode: DashboardPanelMode, lightTheme: boolean): string {
  const business = mode === "business";
  const bodyAttr = lightTheme ? ' data-skippr-business="true"' : "";
  const themeCss = lightTheme ? BUSINESS_LIGHT_THEME_VARS : "";
  const readOnly = business ? "true" : "false";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    ${themeCss}
    body { margin: 0; font: 12px var(--vscode-font-family, system-ui); color: var(--skippr-fg, var(--vscode-foreground)); background: var(--skippr-bg, var(--vscode-editor-background)); }
    .header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--skippr-border, var(--vscode-panel-border)); flex-wrap: wrap; }
    .header h1 { margin: 0; font-size: 15px; font-weight: 650; flex: 1; min-width: 120px; }
    select, input, button { font: inherit; }
    select, input[type="text"], input[type="date"] { padding: 4px 8px; border: 1px solid var(--skippr-border, var(--vscode-input-border)); border-radius: 4px; background: var(--skippr-surface, var(--vscode-input-background)); color: inherit; }
    button { padding: 4px 10px; border: 1px solid var(--skippr-border, var(--vscode-button-border)); border-radius: 4px; background: var(--skippr-accent, var(--vscode-button-background)); color: #fff; cursor: pointer; }
    button.secondary { background: var(--skippr-surface, var(--vscode-button-secondaryBackground)); color: var(--skippr-fg, var(--vscode-button-secondaryForeground)); }
    button:disabled { opacity: .5; cursor: default; }
    .filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--skippr-border, var(--vscode-panel-border)); align-items: flex-end; }
    .filter { display: flex; flex-direction: column; gap: 3px; }
    .filter label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--skippr-muted, var(--vscode-descriptionForeground)); }
    .widgets { display: grid; grid-template-columns: repeat(12, 1fr); gap: 12px; padding: 12px; }
    .widget { grid-column: span 6; border: 1px solid var(--skippr-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--skippr-surface, var(--vscode-editor-background)); min-height: 200px; overflow: hidden; }
    .widget h2 { margin: 0; padding: 8px 10px; font-size: 13px; border-bottom: 1px solid var(--skippr-border, var(--vscode-panel-border)); }
    .widget-body { padding: 0; }
    .widget-sql { margin: 0; padding: 10px; overflow: auto; max-height: 220px; border-top: 1px solid var(--skippr-border, var(--vscode-panel-border)); color: var(--skippr-muted, var(--vscode-descriptionForeground)); background: var(--skippr-bg, var(--vscode-editor-background)); white-space: pre-wrap; }
    .empty, .error { padding: 16px; color: var(--skippr-muted, var(--vscode-descriptionForeground)); }
    .error { color: var(--vscode-errorForeground, #c92a2a); }
    .toolbar-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    ${CHART_PANEL_STYLES}
  </style>
</head>
<body${bodyAttr}>
  <header class="header">
    <h1 id="dash-title">Insights</h1>
    <select id="dash-picker" aria-label="Dashboard"></select>
    <div class="toolbar-actions">
      ${business ? '<button type="button" class="secondary" data-action="askAbout">Ask about dashboard</button>' : `
        <button type="button" class="secondary" data-action="refresh">Refresh</button>
        <button type="button" class="secondary" data-action="addFromEditor">Add chart from editor</button>
        <button type="button" class="secondary" data-action="newDashboard">New dashboard</button>
        <button type="button" class="secondary" data-action="togglePublished">Publish</button>
      `}
    </div>
  </header>
  <section class="filters" id="filters" aria-label="Dashboard filters"></section>
  <main class="widgets" id="widgets"></main>
  <script>
    ${chartScriptBlock()}
    (function () {
      const vscode = acquireVsCodeApi();
      const readOnly = ${readOnly};
      const state = { dashboards: [], dashboard: null, render: null, filterValues: {}, loading: false };
      const titleEl = document.getElementById("dash-title");
      const pickerEl = document.getElementById("dash-picker");
      const filtersEl = document.getElementById("filters");
      const widgetsEl = document.getElementById("widgets");

      function esc(v) { return window.SkipprChart.esc(v); }

      function renderPicker() {
        pickerEl.innerHTML = state.dashboards.map(d =>
          '<option value="' + esc(d.id) + '"' + (state.dashboard && state.dashboard.id === d.id ? ' selected' : '') + '>' + esc(d.title) + '</option>'
        ).join("");
        if (!state.dashboards.length) {
          pickerEl.innerHTML = '<option value="">No dashboards</option>';
        }
      }

      function filterControlHtml(filter) {
        const id = filter.id;
        const val = state.filterValues[id];
        if (filter.type === "date_range") {
          const preset = (val && val.preset) || (filter.default && filter.default.preset) || "last_30d";
          return '<div class="filter"><label>' + esc(filter.label) + '</label><select data-filter-id="' + esc(id) + '" data-filter-kind="date_range">' +
            ["last_7d", "last_30d", "last_90d", "ytd"].map(p => '<option value="' + p + '"' + (preset === p ? ' selected' : '') + '>' + esc(p) + '</option>').join("") +
            '</select></div>';
        }
        if (filter.type === "multi_enum" || filter.type === "enum") {
          const current = Array.isArray(val) ? val[0] : (typeof val === "string" ? val : "");
          const opts = Array.isArray(filter.options) ? filter.options : [];
          return '<div class="filter"><label>' + esc(filter.label) + '</label><select data-filter-id="' + esc(id) + '" data-filter-kind="enum">' +
            '<option value="">All</option>' + opts.map(o => '<option value="' + esc(o) + '"' + (current === o ? ' selected' : '') + '>' + esc(o) + '</option>').join("") +
            '</select></div>';
        }
        if (filter.type === "text") {
          const text = typeof val === "string" ? val : "";
          return '<div class="filter"><label>' + esc(filter.label) + '</label><input type="text" data-filter-id="' + esc(id) + '" data-filter-kind="text" value="' + esc(text) + '" /></div>';
        }
        return "";
      }

      function renderFilters() {
        if (!state.dashboard || !state.render) {
          filtersEl.innerHTML = '<span class="empty">No filters</span>';
          return;
        }
        const defs = state.dashboard.filters || [];
        if (!defs.length) {
          filtersEl.innerHTML = '<span class="empty">No filters defined</span>';
          return;
        }
        filtersEl.innerHTML = defs.map(f => filterControlHtml(f)).join("");
      }

      function widgetStyle(w) {
        const layout = w.layout || {};
        const span = Math.min(12, Math.max(1, layout.w || 6));
        return 'grid-column: span ' + span + ';';
      }

      function renderWidgets() {
        if (state.loading) {
          widgetsEl.innerHTML = '<div class="empty">Loading…</div>';
          return;
        }
        if (!state.render || !Array.isArray(state.render.widgets)) {
          widgetsEl.innerHTML = '<div class="empty">Select a published dashboard to view insights.</div>';
          return;
        }
        widgetsEl.innerHTML = state.render.widgets.map(w => {
          const layout = (state.dashboard.widgets || []).find(x => x.id === w.id);
          const style = layout ? widgetStyle(layout) : 'grid-column: span 6;';
          let body = '';
          if (w.error) {
            body = '<div class="error">' + esc(w.error) + '</div>';
          } else if (w.data && w.data.header) {
            body = '<div class="widget-body">' + window.SkipprChart.chartHtml(w.data, window.SkipprChart.inferChart(w.data.header, w.data.rows || [], w.chart)) + '</div>';
          } else if (w.sql) {
            body = '<div class="empty">SQL saved in dashboard YAML.</div><pre class="widget-sql">' + esc(w.sql) + '</pre>';
          } else {
            body = '<div class="empty">No data</div>';
          }
          return '<article class="widget" style="' + style + '"><h2>' + esc(w.title) + '</h2>' + body + '</article>';
        }).join("");
      }

      function collectFilterValues() {
        const values = {};
        filtersEl.querySelectorAll("[data-filter-id]").forEach(el => {
          const id = el.getAttribute("data-filter-id");
          const kind = el.getAttribute("data-filter-kind");
          if (!id) { return; }
          if (kind === "date_range") {
            values[id] = { preset: el.value };
          } else if (kind === "text") {
            if (el.value) { values[id] = el.value; }
          } else if (kind === "enum" && el.value) {
            values[id] = el.value;
          }
        });
        return values;
      }

      function postRender() {
        if (!state.dashboard) { return; }
        state.loading = true;
        renderWidgets();
        vscode.postMessage({ command: "render", id: state.dashboard.id, filters: collectFilterValues() });
      }

      pickerEl.addEventListener("change", () => {
        const id = pickerEl.value;
        if (id) { vscode.postMessage({ command: "select", id }); }
      });

      filtersEl.addEventListener("change", () => {
        state.filterValues = collectFilterValues();
        postRender();
      });
      filtersEl.addEventListener("input", (e) => {
        if (e.target && e.target.getAttribute("data-filter-kind") === "text") {
          state.filterValues = collectFilterValues();
          postRender();
        }
      });

      document.body.addEventListener("click", e => {
        const btn = e.target.closest("[data-action]");
        if (!btn) { return; }
        const action = btn.getAttribute("data-action");
        if (action === "refresh") { postRender(); return; }
        if (action === "askAbout") {
          vscode.postMessage({ command: "askAbout", id: state.dashboard && state.dashboard.id, filters: collectFilterValues() });
          return;
        }
        if (!readOnly) {
          vscode.postMessage({ command: action, id: state.dashboard && state.dashboard.id });
        }
      });

      window.addEventListener("message", event => {
        const msg = event.data;
        if (!msg || !msg.type) { return; }
        if (msg.type === "dashboardList") {
          state.dashboards = msg.dashboards || [];
          renderPicker();
        }
        if (msg.type === "dashboardState") {
          state.dashboard = msg.dashboard;
          state.render = msg.render;
          state.filterValues = msg.filterValues || state.filterValues;
          state.loading = false;
          if (titleEl && state.dashboard) { titleEl.textContent = state.dashboard.title || "Insights"; }
          renderPicker();
          renderFilters();
          renderWidgets();
        }
        if (msg.type === "dashboardLoading") {
          state.loading = true;
          renderWidgets();
        }
      });

      vscode.postMessage({ command: "ready", readOnly });
    })();
  </script>
</body>
</html>`;
}

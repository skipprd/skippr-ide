export interface SkipprQueryData {
  header: string[];
  rows: string[][];
}

export interface SkipprQueryChart {
  type: string;
  x: string;
  y: string[];
}

import { CHART_PANEL_STYLES } from "./skipprChartRender";

export interface SkipprQueryResultsPanelPayload {
  type: "queryResults";
  status: "idle" | "running" | "success" | "error";
  source?: "sql" | "dbt" | "agent";
  pipeline?: string;
  pipelines_used?: string[];
  question?: string;
  answer?: string;
  sql?: string;
  data?: SkipprQueryData;
  chart?: SkipprQueryChart;
  elapsedMs?: number;
  error?: string;
}

export function renderSkipprQueryResultsPanelHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-panel-background, var(--vscode-editor-background)); font: 12px var(--vscode-font-family); }
    .toolbar { min-height: 30px; display: flex; align-items: center; gap: 10px; padding: 4px 10px; border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; }
    .toolbar strong { font-weight: 600; }
    .spacer { flex: 1; }
    .muted { color: var(--vscode-descriptionForeground); }
    .badge { display: inline-flex; align-items: center; min-height: 18px; padding: 0 6px; border: 1px solid var(--vscode-panel-border); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .badge.running { color: var(--vscode-textLink-foreground); border-color: var(--vscode-textLink-foreground); }
    .badge.success { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); }
    .badge.error { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
    button { all: unset; box-sizing: border-box; padding: 3px 8px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius: 3px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button:disabled { opacity: .45; cursor: default; }
    select { box-sizing: border-box; max-width: 180px; padding: 2px 6px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
    label { display: inline-flex; align-items: center; gap: 4px; color: var(--vscode-descriptionForeground); }
    .answer { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); line-height: 1.45; }
    .sql { margin-top: 6px; padding: 6px 8px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background)); font-family: var(--vscode-editor-font-family); white-space: pre-wrap; }
    .error { padding: 10px; color: var(--vscode-errorForeground); border-bottom: 1px solid var(--vscode-panel-border); }
    .empty { padding: 14px 10px; color: var(--vscode-descriptionForeground); }
    .table-wrap { overflow: auto; max-height: calc(100vh - 92px); }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--vscode-panel-border); border-right: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; vertical-align: top; white-space: nowrap; }
    th { position: sticky; top: 0; z-index: 1; color: var(--vscode-descriptionForeground); font-weight: 600; background: var(--vscode-editor-background); }
    td { font-family: var(--vscode-editor-font-family); }
    ${CHART_PANEL_STYLES}
  </style>
</head>
<body>
  <main id="root"></main>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const root = document.getElementById("root");
      let payload = { type: "queryResults", status: "idle" };
      let mode = "table";
      let chartSelection = null;
      function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
      function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
      function supportedType(type) {
        const t = String(type || "").toLowerCase();
        return t === "line" || t === "bar" || t === "area" ? t : "";
      }
      function csv() {
        const data = payload.data;
        if (!data || !Array.isArray(data.header)) { return ""; }
        const rows = [data.header, ...(Array.isArray(data.rows) ? data.rows : [])];
        return rows.map(row => row.map(cell => '"' + String(cell == null ? "" : cell).replace(/"/g, '""') + '"').join(",")).join("\\n");
      }
      function columnIndex(name) {
        const header = payload.data && payload.data.header;
        return Array.isArray(header) ? header.indexOf(name) : -1;
      }
      function hasData() {
        const data = payload.data;
        return Boolean(data && Array.isArray(data.header) && data.header.length > 1 && Array.isArray(data.rows) && data.rows.length > 0);
      }
      function isNumericColumn(name) {
        const idx = columnIndex(name);
        const rows = payload.data && Array.isArray(payload.data.rows) ? payload.data.rows : [];
        return idx >= 0 && rows.some(row => Number.isFinite(Number(row && row[idx])));
      }
      function looksTemporal(name) {
        return /(^|_)(date|time|day|week|month|year|ts|timestamp)($|_)/i.test(String(name || ""));
      }
      function chartSuggestion() {
        if (payload.source !== "agent" || !payload.chart || !hasData()) { return null; }
        const type = supportedType(payload.chart.type);
        const x = typeof payload.chart.x === "string" && columnIndex(payload.chart.x) >= 0 ? payload.chart.x : "";
        const y = Array.isArray(payload.chart.y) ? payload.chart.y.filter(name => typeof name === "string" && columnIndex(name) >= 0) : [];
        return type && x && y.length ? { type, x, y } : null;
      }
      function inferChart() {
        const data = payload.data;
        if (!data || !Array.isArray(data.header) || data.header.length < 2) { return null; }
        const numeric = data.header.filter(isNumericColumn);
        const x = data.header.find(name => !numeric.includes(name)) || data.header[0];
        const y = numeric.filter(name => name !== x).slice(0, 3);
        if (!x || y.length === 0) { return null; }
        return { type: looksTemporal(x) ? "line" : "bar", x, y };
      }
      function activeChart() {
        if (!hasData()) { return null; }
        const header = payload.data.header;
        const current = chartSelection;
        if (current && supportedType(current.type) && header.includes(current.x) && current.y.some(name => header.includes(name))) {
          return { type: supportedType(current.type), x: current.x, y: current.y.filter(name => header.includes(name)) };
        }
        const next = chartSuggestion() || inferChart();
        chartSelection = next;
        return next;
      }
      function optionHtml(value, selected) {
        return '<option value="' + esc(value) + '" ' + (selected ? "selected" : "") + '>' + esc(value) + '</option>';
      }
      function tableHtml() {
        const data = payload.data;
        if (!data || !Array.isArray(data.header) || data.header.length === 0) {
          return '<div class="empty">No rows returned.</div>';
        }
        const rows = Array.isArray(data.rows) ? data.rows : [];
        return '<div class="table-wrap"><table><thead><tr>' +
          data.header.map(h => '<th>' + esc(h) + '</th>').join("") +
          '</tr></thead><tbody>' +
          rows.map(row => '<tr>' + data.header.map((_, i) => '<td>' + esc(row && row[i]) + '</td>').join("") + '</tr>').join("") +
          '</tbody></table></div>';
      }
      function chartHtml() {
        const chart = activeChart();
        const data = payload.data;
        if (!chart || !data || !Array.isArray(data.rows)) {
          return '<div class="empty">Choose columns with at least one numeric measure to chart this result.</div>';
        }
        const xIdx = columnIndex(chart.x);
        const yIdxs = Array.isArray(chart.y) ? chart.y.map(columnIndex).filter(i => i >= 0) : [];
        if (xIdx < 0 || yIdxs.length === 0) {
          return '<div class="empty">The selected chart columns do not match this result.</div>';
        }
        const rows = data.rows.slice(0, 40);
        const max = Math.max(1, ...rows.flatMap(row => yIdxs.map(i => Math.abs(num(row[i])))));
        const legend = yIdxs.map(i => '<span>' + esc(data.header[i]) + '</span>').join("");
        const chartType = String(chart.type || "bar").toLowerCase();
        if (chartType === "line" || chartType === "area") {
          const width = 760;
          const height = 190;
          const step = rows.length > 1 ? width / (rows.length - 1) : width;
          const paths = yIdxs.map((idx, series) => {
            const points = rows.map((row, i) => {
              const x = i * step;
              const y = height - (Math.abs(num(row[idx])) / max) * height;
              return x + "," + y;
            }).join(" ");
            const color = ["var(--vscode-charts-blue)", "var(--vscode-charts-green)", "var(--vscode-charts-purple)"][series] || "var(--vscode-charts-orange)";
            const area = chartType === "area" && rows.length ? '<polygon fill="' + color + '" fill-opacity=".18" stroke="none" points="0,' + height + ' ' + points + ' ' + width + ',' + height + '"></polygon>' : "";
            return area + '<polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + points + '"></polyline>';
          }).join("");
          return '<section class="chart"><div class="chart-title">' + esc(chart.type) + ': ' + esc(chart.x) + ' by ' + esc(chart.y.join(", ")) + '</div><svg class="line-chart" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' + paths + '</svg><div class="legend">' + legend + '</div></section>';
        }
        return '<section class="chart"><div class="chart-title">' + esc(chart.type || "bar") + ': ' + esc(chart.x) + ' by ' + esc(chart.y.join(", ")) + '</div><div class="bars">' +
          rows.map(row => '<div class="bar-group" title="' + esc(row[xIdx]) + '">' + yIdxs.map(i => '<div class="bar" style="height:' + Math.max(3, (Math.abs(num(row[i])) / max) * 100) + '%"></div>').join("") + '</div>').join("") +
          '</div><div class="legend">' + legend + '</div></section>';
      }
      function chartControlsHtml(chart) {
        const data = payload.data;
        if (mode !== "chart" || !data || !Array.isArray(data.header) || !chart) { return ""; }
        return '<label>Type <select data-chart-field="type">' +
          ["bar", "line", "area"].map(type => optionHtml(type, chart.type === type)).join("") +
          '</select></label><label>X <select data-chart-field="x">' +
          data.header.map(name => optionHtml(name, chart.x === name)).join("") +
          '</select></label><label>Y <select data-chart-field="y">' +
          data.header.map(name => optionHtml(name, chart.y.includes(name))).join("") +
          '</select></label>';
      }
      function header() {
        const rows = payload.data && Array.isArray(payload.data.rows) ? payload.data.rows.length : 0;
        const canChart = Boolean(activeChart());
        const controls = chartControlsHtml(activeChart());
        const pipelineLabel = Array.isArray(payload.pipelines_used) && payload.pipelines_used.length ? payload.pipelines_used.join(", ") : (payload.pipeline || "");
        return '<div class="toolbar"><strong>' + esc(payload.source === "agent" ? "Agent query" : payload.source === "dbt" ? "dbt SQL" : "SQL query") + '</strong><span class="badge ' + esc(payload.status || "idle") + '">' + esc(payload.status || "idle") + '</span><span class="muted">' + esc(pipelineLabel) + '</span><span class="muted">' + rows + ' rows</span><span class="spacer"></span>' + controls + '<button data-action="copySql" ' + (payload.sql ? "" : "disabled") + '>Copy SQL</button><button data-action="copyCsv" ' + (rows ? "" : "disabled") + '>Copy CSV</button><button data-mode="table" class="' + (mode === "table" ? "active" : "") + '">Table</button><button data-mode="chart" class="' + (mode === "chart" ? "active" : "") + '" ' + (canChart ? "" : "disabled") + '>Chart</button></div>';
      }
      function render() {
        if (payload.status === "idle") {
          root.innerHTML = header() + '<div class="empty">Run SQL from the editor or ask a data question to populate results.</div>';
          return;
        }
        const answer = payload.answer ? '<div class="answer">' + esc(payload.answer) + (payload.sql ? '<div class="sql">' + esc(payload.sql) + '</div>' : '') + '</div>' : (payload.sql ? '<div class="answer"><div class="sql">' + esc(payload.sql) + '</div></div>' : "");
        const body = payload.status === "error" ? '<div class="error">' + esc(payload.error || "Query failed") + '</div>' : (mode === "chart" ? chartHtml() : tableHtml());
        root.innerHTML = header() + answer + body;
      }
      root.addEventListener("change", event => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) { return; }
        const field = target.getAttribute("data-chart-field");
        if (!field) { return; }
        const chart = activeChart();
        if (!chart) { return; }
        if (field === "type") { chart.type = supportedType(target.value) || "bar"; }
        if (field === "x") { chart.x = target.value; }
        if (field === "y") { chart.y = [target.value]; }
        chartSelection = chart;
        render();
      });
      root.addEventListener("click", event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        const nextMode = target.getAttribute("data-mode");
        if (nextMode) { mode = nextMode; render(); return; }
        const action = target.getAttribute("data-action");
        if (action === "copySql" && payload.sql) { vscode.postMessage({ command: "copy", text: payload.sql }); }
        if (action === "copyCsv") { vscode.postMessage({ command: "copy", text: csv() }); }
      });
      window.addEventListener("message", event => {
        if (event.data && event.data.type === "queryResults") {
          payload = event.data;
          if (mode === "chart" && !activeChart()) { mode = "table"; }
          render();
        }
      });
      render();
    }());
  </script>
</body>
</html>`;
}

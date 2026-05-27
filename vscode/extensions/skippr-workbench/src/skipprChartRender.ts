/** Shared chart/table rendering for query results and dashboards. */

export const CHART_PANEL_STYLES = `
    .chart { padding: 14px 12px; }
    .chart-title { margin-bottom: 10px; color: var(--skippr-muted, var(--vscode-descriptionForeground)); }
    .bars { display: flex; align-items: flex-end; gap: 8px; height: 180px; border-left: 1px solid var(--skippr-border, var(--vscode-panel-border)); border-bottom: 1px solid var(--skippr-border, var(--vscode-panel-border)); padding: 8px; }
    .bar-group { flex: 1; min-width: 22px; display: flex; align-items: flex-end; justify-content: center; gap: 3px; height: 100%; }
    .bar { min-width: 8px; max-width: 18px; flex: 1; background: var(--skippr-chart-blue, var(--vscode-charts-blue)); }
    .bar:nth-child(2) { background: var(--skippr-chart-green, var(--vscode-charts-green)); }
    .bar:nth-child(3) { background: var(--skippr-chart-purple, var(--vscode-charts-purple)); }
    .line-chart { width: 100%; height: 210px; }
    .legend { margin-top: 8px; display: flex; gap: 14px; flex-wrap: wrap; color: var(--skippr-muted, var(--vscode-descriptionForeground)); }
    .table-wrap { overflow: auto; max-height: 320px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--skippr-border, var(--vscode-panel-border)); border-right: 1px solid var(--skippr-border, var(--vscode-panel-border)); padding: 4px 8px; text-align: left; vertical-align: top; white-space: nowrap; }
    th { position: sticky; top: 0; z-index: 1; color: var(--skippr-muted, var(--vscode-descriptionForeground)); font-weight: 600; background: var(--skippr-surface, var(--vscode-editor-background)); }
`;

export const BUSINESS_LIGHT_THEME_VARS = `
    :root, [data-skippr-business="true"] {
      --skippr-bg: #f8f9fc;
      --skippr-surface: #ffffff;
      --skippr-fg: #1a1d26;
      --skippr-muted: #5c6370;
      --skippr-border: #d8dee9;
      --skippr-accent: #3b5bdb;
      --skippr-chart-blue: #3b5bdb;
      --skippr-chart-green: #2f9e44;
      --skippr-chart-purple: #7950f2;
    }
    body[data-skippr-business="true"] {
      color: var(--skippr-fg);
      background: var(--skippr-bg);
    }
`;

/** Inline script defining SkipprChart helpers on `window.SkipprChart`. */
export function chartScriptBlock(): string {
  return `
      window.SkipprChart = (function () {
        function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
        function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
        function supportedType(type) {
          const t = String(type || "").toLowerCase();
          return t === "line" || t === "bar" || t === "area" ? t : "";
        }
        function columnIndex(header, name) {
          return Array.isArray(header) ? header.indexOf(name) : -1;
        }
        function looksTemporal(name) {
          return /(^|_)(date|time|day|week|month|year|ts|timestamp)($|_)/i.test(String(name || ""));
        }
        function isNumericColumn(header, rows, name) {
          const idx = columnIndex(header, name);
          return idx >= 0 && rows.some(row => Number.isFinite(Number(row && row[idx])));
        }
        function inferChart(header, rows, explicit) {
          if (explicit && explicit.x && Array.isArray(explicit.y) && explicit.y.length) {
            const type = supportedType(explicit.type) || "bar";
            if (columnIndex(header, explicit.x) >= 0 && explicit.y.some(y => columnIndex(header, y) >= 0)) {
              return { type, x: explicit.x, y: explicit.y.filter(y => columnIndex(header, y) >= 0) };
            }
          }
          if (!header || header.length < 2 || !rows || !rows.length) { return null; }
          const numeric = header.filter(name => isNumericColumn(header, rows, name));
          const x = header.find(name => !numeric.includes(name)) || header[0];
          const y = numeric.filter(name => name !== x).slice(0, 3);
          if (!x || !y.length) { return null; }
          return { type: looksTemporal(x) ? "line" : "bar", x, y };
        }
        function chartHtml(data, chart) {
          if (!chart || !data || !Array.isArray(data.header) || !Array.isArray(data.rows)) {
            return '<div class="empty">No chartable data.</div>';
          }
          const xIdx = columnIndex(data.header, chart.x);
          const yIdxs = Array.isArray(chart.y) ? chart.y.map(name => columnIndex(data.header, name)).filter(i => i >= 0) : [];
          if (xIdx < 0 || !yIdxs.length) {
            return '<div class="empty">Chart columns not found.</div>';
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
              const colors = ["var(--skippr-chart-blue)", "var(--skippr-chart-green)", "var(--skippr-chart-purple)"];
              const color = colors[series] || "var(--skippr-chart-blue)";
              const area = chartType === "area" && rows.length ? '<polygon fill="' + color + '" fill-opacity=".18" stroke="none" points="0,' + height + ' ' + points + ' ' + width + ',' + height + '"></polygon>' : "";
              return area + '<polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + points + '"></polyline>';
            }).join("");
            return '<section class="chart"><div class="chart-title">' + esc(chart.type) + ': ' + esc(chart.x) + '</div><svg class="line-chart" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' + paths + '</svg><div class="legend">' + legend + '</div></section>';
          }
          return '<section class="chart"><div class="chart-title">' + esc(chart.type || "bar") + ': ' + esc(chart.x) + '</div><div class="bars">' +
            rows.map(row => '<div class="bar-group" title="' + esc(row[xIdx]) + '">' + yIdxs.map(i => '<div class="bar" style="height:' + Math.max(3, (Math.abs(num(row[i])) / max) * 100) + '%"></div>').join("") + '</div>').join("") +
            '</div><div class="legend">' + legend + '</div></section>';
        }
        return { esc, inferChart, chartHtml };
      })();
  `;
}

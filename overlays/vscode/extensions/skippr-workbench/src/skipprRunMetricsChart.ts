/** Sync run metrics chart: WAL backlog line + cumulative sink bars. */

import type { SkipprRunHistoryMetricPoint } from "./skipprRunState";

export const SYNC_METRIC_HISTORY_MAX = 30;

export interface MetricPointLike {
  timestamp?: string;
  wal_write_rows_total?: number;
  parquet_persisted_rows_total?: number;
  rows_written?: number;
  messages_total?: number;
  bytes_total?: number;
  parquet_persisted_bytes_total?: number;
  deadletters_total?: number;
  [key: string]: unknown;
}

export interface SyncMetricBucket {
  timestamp: string;
  backlog: number;
  synced: number;
}

export function metricValue(point: MetricPointLike | undefined, keys: string[]): number {
  if (!point) {
    return 0;
  }
  for (const key of keys) {
    const value = Number(point[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

export function counterDelta(current: number, previous: number): number {
  if (current < previous) {
    return current;
  }
  return current - previous;
}

/** Unpersisted pipeline backlog: WAL rows written minus rows persisted toward the sink. */
export function walBacklogLevel(point: MetricPointLike): number {
  const wal = metricValue(point, ["wal_write_rows_total"]);
  const synced = metricValue(point, ["parquet_persisted_rows_total", "rows_written"]);
  if (wal > 0 || synced > 0) {
    return Math.max(0, wal - synced);
  }
  return Math.max(0, metricValue(point, ["messages_total"]) - metricValue(point, ["rows_written"]));
}

/** Drop trailing padding slots only (keep all real samples through run end, including flush). */
export function trimTrailingIdleBuckets(buckets: SyncMetricBucket[]): SyncMetricBucket[] {
  let end = buckets.length;
  while (end > 1 && isEmptyMetricBucket(buckets[end - 1]!)) {
    end--;
  }
  return buckets.slice(0, end);
}

export function syncedRowsTotal(point: MetricPointLike): number {
  return metricValue(point, ["rows_written", "parquet_persisted_rows_total"]);
}

const EMPTY_BUCKET: SyncMetricBucket = { timestamp: "", backlog: 0, synced: 0 };

export function isEmptyMetricBucket(bucket: SyncMetricBucket): boolean {
  return !bucket.timestamp && bucket.backlog <= 0 && bucket.synced <= 0;
}

/** Shared Y scale so WAL backlog and synced totals are visually comparable. */
export function syncPlotMax(buckets: SyncMetricBucket[]): number {
  const data = buckets.filter((b) => !isEmptyMetricBucket(b));
  if (!data.length) {
    return 1;
  }
  return Math.max(1, ...data.flatMap((b) => [b.backlog, b.synced]));
}

/** First real sample at backlog zero, else the first real sample in the series. */
export function walLineStartIndex(buckets: SyncMetricBucket[]): number {
  let firstData = -1;
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i]!;
    if (isEmptyMetricBucket(bucket)) {
      continue;
    }
    if (firstData < 0) {
      firstData = i;
    }
    if (bucket.backlog === 0) {
      return i;
    }
  }
  return Math.max(0, firstData);
}

export function walLineEndIndex(buckets: SyncMetricBucket[]): number {
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i]!.timestamp) {
      return i;
    }
  }
  return -1;
}

/** SVG polyline points (viewBox 0–100) for WAL backlog from first zero through last sample. */
export function buildWalLinePoints(
  buckets: SyncMetricBucket[],
  max: number
): string {
  const start = walLineStartIndex(buckets);
  const end = walLineEndIndex(buckets);
  if (end < start || !buckets.length) {
    return "";
  }
  const scaleMax = Math.max(1, max);
  const n = buckets.length;
  const coords: string[] = [];
  for (let i = start; i <= end; i++) {
    const bucket = buckets[i]!;
    if (isEmptyMetricBucket(bucket)) {
      continue;
    }
    const x = ((i + 0.5) / n) * 100;
    const y = 100 - (bucket.backlog / scaleMax) * 100;
    coords.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  if (coords.length === 1) {
    const [only] = coords;
    const x = only.split(",")[0]!;
    coords.push(`${x},100`);
  }
  return coords.join(" ");
}

/** Live runs: fixed slot timeline; samples align to the right (newest on the right). */
export function padLiveMetricSlots(
  buckets: SyncMetricBucket[],
  slotCount = SYNC_METRIC_HISTORY_MAX
): SyncMetricBucket[] {
  if (buckets.length >= slotCount) {
    return buckets.slice(-slotCount);
  }
  const padding = Array.from({ length: slotCount - buckets.length }, () => ({ ...EMPTY_BUCKET }));
  return [...padding, ...buckets];
}

export function buildSyncMetricBuckets(points: MetricPointLike[]): SyncMetricBucket[] {
  return points.map((point) => ({
    timestamp: String(point.timestamp ?? ""),
    backlog: walBacklogLevel(point),
    synced: syncedRowsTotal(point)
  }));
}

export function compactMetricSamples<T extends MetricPointLike>(points: T[], maxSamples = SYNC_METRIC_HISTORY_MAX): T[] {
  if (points.length <= maxSamples) {
    return points;
  }
  return points.slice(-maxSamples);
}

export function toHistoryMetricPoint(point: MetricPointLike): SkipprRunHistoryMetricPoint {
  return {
    timestamp: String(point.timestamp ?? ""),
    wal_write_rows_total: metricValue(point, ["wal_write_rows_total"]) || undefined,
    parquet_persisted_rows_total: metricValue(point, ["parquet_persisted_rows_total"]) || undefined,
    rows_written: metricValue(point, ["rows_written"]) || undefined,
    messages_total: metricValue(point, ["messages_total"]) || undefined
  };
}

export function syncMetricHistorySamples(
  run: { metricPoints: MetricPointLike[] },
  maxSamples = SYNC_METRIC_HISTORY_MAX
): SkipprRunHistoryMetricPoint[] | undefined {
  if (!run.metricPoints.length) {
    return undefined;
  }
  return compactMetricSamples(run.metricPoints, maxSamples).map(toHistoryMetricPoint);
}

/** CSS shared by run status and run details webviews. */
export function syncMetricsChartStyles(): string {
  return `
    .live-metrics { margin-top: 6px; }
    .metrics-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .live-metrics.compact .metrics-legend { gap: 8px; margin-bottom: 2px; font-size: 9px; }
    .metrics-legend-item { display: inline-flex; align-items: center; gap: 4px; }
    .metrics-swatch-line { width: 14px; height: 0; border-top: 2px solid var(--vscode-charts-blue); }
    .metrics-swatch-bar { width: 8px; height: 8px; background: var(--vscode-charts-green); }
    .metrics-plot { position: relative; width: 100%; }
    .metrics-bars { display: flex; align-items: flex-end; gap: 2px; height: var(--metrics-height, 48px); }
    .metrics-bucket { flex: 1; min-width: 3px; height: 100%; }
    .metrics-column { position: relative; width: 100%; height: 100%; display: flex; align-items: flex-end; justify-content: center; }
    .metrics-bar { width: 70%; min-height: 2px; background: var(--vscode-charts-green); opacity: .92; flex-shrink: 0; }
    .metrics-bar.zero { opacity: .2; min-height: 2px; }
    .metrics-wal-line { position: absolute; left: 0; top: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
    .metrics-bars { position: relative; z-index: 1; }
    .live-metrics.frozen .metrics-plot,
    .live-metrics.frozen .metrics-bars { width: max-content; max-width: 100%; }
    .live-metrics.frozen .metrics-bucket { flex: 0 0 8px; }
    .live-metrics.timeline .metrics-plot { border-bottom: 1px solid var(--vscode-panel-border); box-sizing: border-box; }
  `;
}

export function syncMetricsLegendHtml(): string {
  return (
    '<div class="metrics-legend">' +
    '<span class="metrics-legend-item"><span class="metrics-swatch-line"></span>WAL backlog</span>' +
    '<span class="metrics-legend-item"><span class="metrics-swatch-bar"></span>Synced rows (total)</span>' +
    "</div>"
  );
}

/** In-webview helpers for rendering the dual-series chart. */
export function buildSyncMetricsChartScript(): string {
  return `
      function metricValue(point, keys) {
        if (!point) { return 0; }
        for (const key of keys) {
          const value = Number(point[key]);
          if (Number.isFinite(value)) { return value; }
        }
        return 0;
      }
      function counterDelta(current, previous) {
        if (current < previous) { return current; }
        return current - previous;
      }
      function walBacklogLevel(point) {
        const wal = metricValue(point, ["wal_write_rows_total"]);
        const synced = metricValue(point, ["parquet_persisted_rows_total", "rows_written"]);
        if (wal > 0 || synced > 0) {
          return Math.max(0, wal - synced);
        }
        return Math.max(0, metricValue(point, ["messages_total"]) - metricValue(point, ["rows_written"]));
      }
      function syncedRowsTotal(point) {
        return metricValue(point, ["rows_written", "parquet_persisted_rows_total"]);
      }
      function buildSyncMetricBuckets(points) {
        return (Array.isArray(points) ? points : []).map(point => ({
          timestamp: point.timestamp || "",
          backlog: walBacklogLevel(point),
          synced: syncedRowsTotal(point)
        }));
      }
      function compactMetricSamples(points, maxSamples) {
        const list = Array.isArray(points) ? points : [];
        const limit = typeof maxSamples === "number" ? maxSamples : 30;
        return list.length <= limit ? list : list.slice(-limit);
      }
      function trimTrailingIdleBuckets(buckets) {
        let end = buckets.length;
        while (end > 1 && isEmptyMetricBucket(buckets[end - 1])) {
          end--;
        }
        return buckets.slice(0, end);
      }
      function isEmptyMetricBucket(bucket) {
        return !bucket.timestamp && bucket.backlog <= 0 && bucket.synced <= 0;
      }
      function syncPlotMax(buckets) {
        const data = buckets.filter(b => !isEmptyMetricBucket(b));
        if (!data.length) { return 1; }
        return Math.max(1, ...data.flatMap(b => [b.backlog, b.synced]));
      }
      function padLiveMetricSlots(buckets, slotCount) {
        const limit = typeof slotCount === "number" ? slotCount : 30;
        if (buckets.length >= limit) {
          return buckets.slice(-limit);
        }
        const padding = [];
        for (let i = 0; i < limit - buckets.length; i++) {
          padding.push({ timestamp: "", backlog: 0, synced: 0 });
        }
        return padding.concat(buckets);
      }
      function renderMetricBucket(bucket, max, plotHeight, frozen) {
        if (isEmptyMetricBucket(bucket)) {
          return '<div class="metrics-bucket"></div>';
        }
        const title = esc(
          (bucket.timestamp ? bucket.timestamp + "\\n" : "") +
          "WAL backlog: " + num(bucket.backlog) + "\\nSynced total: " + num(bucket.synced)
        );
        let barHtml = "";
        if (!(frozen && bucket.synced <= 0)) {
          const h = bucket.synced <= 0 ? 2 : Math.max(2, Math.round((bucket.synced / max) * plotHeight));
          const zeroClass = !frozen && bucket.synced <= 0 ? " zero" : "";
          barHtml = '<div class="metrics-bar' + zeroClass + '" style="height:' + h + 'px"></div>';
        }
        return '<div class="metrics-bucket" title="' + title + '"><div class="metrics-column">' + barHtml + '</div></div>';
      }
      function walLineStartIndex(buckets) {
        let firstData = -1;
        for (let i = 0; i < buckets.length; i++) {
          const bucket = buckets[i];
          if (isEmptyMetricBucket(bucket)) { continue; }
          if (firstData < 0) { firstData = i; }
          if (bucket.backlog === 0) { return i; }
        }
        return Math.max(0, firstData);
      }
      function walLineEndIndex(buckets) {
        for (let i = buckets.length - 1; i >= 0; i--) {
          if (buckets[i].timestamp) { return i; }
        }
        return -1;
      }
      function buildWalLinePoints(buckets, max) {
        const start = walLineStartIndex(buckets);
        const end = walLineEndIndex(buckets);
        if (end < start || !buckets.length) { return ""; }
        const scaleMax = Math.max(1, max);
        const n = buckets.length;
        const coords = [];
        for (let i = start; i <= end; i++) {
          const bucket = buckets[i];
          if (isEmptyMetricBucket(bucket)) { continue; }
          const x = ((i + 0.5) / n) * 100;
          const y = 100 - (bucket.backlog / scaleMax) * 100;
          coords.push(x.toFixed(2) + "," + y.toFixed(2));
        }
        if (coords.length === 1) {
          const x = coords[0].split(",")[0];
          coords.push(x + ",100");
        }
        return coords.join(" ");
      }
      function buildWalLineHtml(buckets, max) {
        const points = buildWalLinePoints(buckets, max);
        if (!points) { return ""; }
        return '<svg class="metrics-wal-line" viewBox="0 0 100 100" preserveAspectRatio="none">' +
          '<polyline fill="none" stroke="var(--vscode-charts-blue)" stroke-width="1.5" vector-effect="non-scaling-stroke" points="' + points + '" /></svg>';
      }
      function buildLiveSyncChart(points, options) {
        const opts = options || {};
        const height = typeof opts.height === "number" ? opts.height : 48;
        const maxSamples = typeof opts.maxSamples === "number" ? opts.maxSamples : 30;
        const compact = Boolean(opts.compact);
        const frozen = Boolean(opts.frozen);
        const samples = compactMetricSamples(points, maxSamples);
        let buckets = buildSyncMetricBuckets(samples);
        if (frozen) {
          buckets = trimTrailingIdleBuckets(buckets);
        } else {
          buckets = padLiveMetricSlots(buckets, maxSamples);
        }
        const legend =
          '<div class="metrics-legend">' +
            '<span class="metrics-legend-item"><span class="metrics-swatch-line"></span>WAL backlog</span>' +
            '<span class="metrics-legend-item"><span class="metrics-swatch-bar"></span>Synced rows (total)</span>' +
          '</div>';
        const plotHeight = height - 2;
        const dataBuckets = buckets.filter(b => !isEmptyMetricBucket(b));
        const plotMax = syncPlotMax(buckets);
        const columns = buckets.map(bucket => renderMetricBucket(bucket, plotMax, plotHeight, frozen)).join("");
        const walLine = buildWalLineHtml(buckets, plotMax);
        const classes = "live-metrics timeline" +
          (compact ? " compact" : "") +
          (frozen && dataBuckets.length ? " frozen" : "");
        return '<div class="' + classes + '">' + legend +
          '<div class="metrics-plot" style="--metrics-height:' + height + 'px">' +
            walLine +
            '<div class="metrics-bars">' + columns + '</div>' +
          '</div></div>';
      }
  `;
}

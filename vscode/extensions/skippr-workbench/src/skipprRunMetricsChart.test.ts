import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSyncMetricBuckets,
  buildWalLinePoints,
  compactMetricSamples,
  counterDelta,
  syncMetricHistorySamples,
  isEmptyMetricBucket,
  padLiveMetricSlots,
  syncPlotMax,
  trimTrailingIdleBuckets,
  walBacklogLevel,
  walLineStartIndex
} from "./skipprRunMetricsChart.js";

test("walBacklogLevel rises then falls as sync catches up", () => {
  const p1 = { wal_write_rows_total: 100, parquet_persisted_rows_total: 20 };
  const p2 = { wal_write_rows_total: 200, parquet_persisted_rows_total: 40 };
  const p3 = { wal_write_rows_total: 250, parquet_persisted_rows_total: 240 };
  assert.equal(walBacklogLevel(p1), 80);
  assert.equal(walBacklogLevel(p2), 160);
  assert.equal(walBacklogLevel(p3), 10);
});

test("buildSyncMetricBuckets uses cumulative synced totals", () => {
  const buckets = buildSyncMetricBuckets([
    { timestamp: "t1", rows_written: 10, wal_write_rows_total: 50 },
    { timestamp: "t2", rows_written: 30, wal_write_rows_total: 80 },
    { timestamp: "t3", rows_written: 55, wal_write_rows_total: 60 }
  ]);
  assert.equal(buckets.length, 3);
  assert.equal(buckets[0].synced, 10);
  assert.equal(buckets[1].synced, 30);
  assert.equal(buckets[2].synced, 55);
});

test("compactMetricSamples does not insert placeholder points", () => {
  const points = [{ timestamp: "a" }, { timestamp: "b" }, { timestamp: "c" }];
  const compact = compactMetricSamples(points, 2);
  assert.equal(compact.length, 2);
  assert.equal(compact[0].timestamp, "b");
  assert.equal(compact[1].timestamp, "c");
});

test("counterDelta handles counter reset", () => {
  assert.equal(counterDelta(5, 100), 5);
});

test("padLiveMetricSlots reserves slots with newest on the right", () => {
  const padded = padLiveMetricSlots(
    [
      { timestamp: "t1", backlog: 1, synced: 1 },
      { timestamp: "t2", backlog: 2, synced: 2 }
    ],
    5
  );
  assert.equal(padded.length, 5);
  assert.equal(isEmptyMetricBucket(padded[0]!), true);
  assert.equal(padded[4]!.timestamp, "t2");
});

test("trimTrailingIdleBuckets keeps flush heartbeats when synced is flat but backlog is reported", () => {
  const buckets = buildSyncMetricBuckets([
    { timestamp: "t1", rows_written: 10, wal_write_rows_total: 20 },
    { timestamp: "t2", rows_written: 30, wal_write_rows_total: 40 },
    { timestamp: "t3", rows_written: 30, wal_write_rows_total: 40 },
    { timestamp: "t4", rows_written: 30, wal_write_rows_total: 40 }
  ]);
  const trimmed = trimTrailingIdleBuckets(buckets);
  assert.equal(trimmed.length, 4);
  assert.equal(trimmed[3]!.backlog, 10);
});

test("trimTrailingIdleBuckets removes trailing empty padding slots only", () => {
  const buckets = [
    { timestamp: "t1", backlog: 5, synced: 10 },
    { timestamp: "", backlog: 0, synced: 0 }
  ];
  const trimmed = trimTrailingIdleBuckets(buckets);
  assert.equal(trimmed.length, 1);
});

test("walLineStartIndex begins at first zero backlog sample", () => {
  const buckets = padLiveMetricSlots(
    buildSyncMetricBuckets([
      { timestamp: "t1", rows_written: 0, wal_write_rows_total: 0 },
      { timestamp: "t2", rows_written: 10, wal_write_rows_total: 50 },
      { timestamp: "t3", rows_written: 30, wal_write_rows_total: 80 }
    ]),
    5
  );
  assert.equal(walLineStartIndex(buckets), 2);
});

test("buildWalLinePoints connects from first zero through the series", () => {
  const buckets = buildSyncMetricBuckets([
    { timestamp: "t1", rows_written: 0, wal_write_rows_total: 0 },
    { timestamp: "t2", rows_written: 10, wal_write_rows_total: 50 },
    { timestamp: "t3", rows_written: 30, wal_write_rows_total: 80 }
  ]);
  const points = buildWalLinePoints(buckets, 40);
  assert.ok(points.includes("16.67,100"));
  assert.ok(points.split(" ").length >= 3);
});

test("syncPlotMax uses peak backlog and final synced on one scale", () => {
  const buckets = buildSyncMetricBuckets([
    { timestamp: "t1", rows_written: 0, wal_write_rows_total: 100 },
    { timestamp: "t2", rows_written: 40, wal_write_rows_total: 500 },
    { timestamp: "t3", rows_written: 200, wal_write_rows_total: 1000 },
    { timestamp: "t4", rows_written: 1000, wal_write_rows_total: 1000 }
  ]);
  const plotMax = syncPlotMax(buckets);
  const peakBacklog = Math.max(...buckets.map((b) => b.backlog));
  const final = buckets[3]!;
  assert.equal(final.backlog, 0);
  assert.ok(final.synced >= peakBacklog);
  assert.equal(plotMax, final.synced);
  assert.ok(peakBacklog / plotMax < final.synced / plotMax);
});

test("early samples show backlog dominating synced on shared scale", () => {
  const buckets = buildSyncMetricBuckets([
    { timestamp: "t1", rows_written: 5, wal_write_rows_total: 200 },
    { timestamp: "t2", rows_written: 20, wal_write_rows_total: 500 }
  ]);
  const plotMax = syncPlotMax(buckets);
  assert.ok(buckets[0]!.backlog / plotMax > buckets[0]!.synced / plotMax);
  assert.ok(buckets[1]!.backlog / plotMax > buckets[1]!.synced / plotMax);
});

test("syncMetricHistorySamples retains counter fields", () => {
  const samples = syncMetricHistorySamples({
    metricPoints: [
      {
        timestamp: "t1",
        wal_write_rows_total: 10,
        parquet_persisted_rows_total: 2,
        rows_written: 2,
        messages_total: 10
      }
    ]
  });
  assert.ok(samples);
  assert.equal(samples![0].wal_write_rows_total, 10);
  assert.equal(samples![0].parquet_persisted_rows_total, 2);
});

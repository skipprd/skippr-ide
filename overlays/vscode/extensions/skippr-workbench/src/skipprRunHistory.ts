import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { SkipprObservedRun, SkipprRunHistorySummary, summarizeRun } from "./skipprRunState";

interface RunRow {
  id: string;
  payload: string;
}

const SQLITE_BUSY_RETRIES = 8;
const SQLITE_BUSY_BASE_MS = 40;

export class SkipprRunHistory {
  private initialized = false;
  /** Serialize every sqlite3 invocation — concurrent processes caused `database is locked`. */
  private readonly chain: { tail: Promise<void> } = { tail: Promise.resolve() };

  constructor(
    private readonly workspaceRoot: string,
    private readonly output: vscode.LogOutputChannel
  ) {}

  private get ideDir(): string {
    return path.join(this.workspaceRoot, ".skippr", "ide");
  }

  private get dbPath(): string {
    return path.join(this.ideDir, "runs.sqlite");
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.tail.then(task);
    this.chain.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.enqueue(async () => {
      await fs.mkdir(this.ideDir, { recursive: true });
      await this.ensureLocalIgnore();
      await this.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=10000;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          command TEXT NOT NULL,
          pipeline TEXT,
          status TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          elapsed_ms INTEGER,
          total_rows INTEGER,
          freshness_iso TEXT,
          deadletters_total INTEGER,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS run_events (
          run_id TEXT NOT NULL,
          event_index INTEGER NOT NULL,
          event_name TEXT NOT NULL,
          timestamp TEXT,
          payload TEXT NOT NULL,
          PRIMARY KEY (run_id, event_index)
        );
        CREATE TABLE IF NOT EXISTS run_metric_points (
          run_id TEXT NOT NULL,
          point_index INTEGER NOT NULL,
          timestamp TEXT,
          payload TEXT NOT NULL,
          PRIMARY KEY (run_id, point_index)
        );
        CREATE TABLE IF NOT EXISTS run_schema_changes (
          run_id TEXT NOT NULL,
          change_index INTEGER NOT NULL,
          namespace TEXT NOT NULL,
          timestamp TEXT,
          payload TEXT NOT NULL,
          PRIMARY KEY (run_id, change_index)
        );
        CREATE TABLE IF NOT EXISTS run_deadletters (
          run_id TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
      `);
      this.initialized = true;
    });
  }

  async saveRun(run: SkipprObservedRun): Promise<void> {
    await this.init();
    return this.enqueue(() => this.saveRunInner(run));
  }

  private async saveRunInner(run: SkipprObservedRun): Promise<void> {
    const summary = summarizeRun(run);
    const statements = [
      `BEGIN IMMEDIATE;`,
      `INSERT OR REPLACE INTO runs (id, command, pipeline, status, started_at, finished_at, elapsed_ms, total_rows, freshness_iso, deadletters_total, payload) VALUES (${sqlString(run.id)}, ${sqlString(run.command)}, ${sqlNullable(run.pipeline)}, ${sqlString(run.status)}, ${run.startedAt}, ${sqlNumber(run.finishedAt)}, ${sqlNumber(run.elapsedMs)}, ${sqlNumber(summary.totalRows)}, ${sqlNullable(summary.freshnessIso)}, ${sqlNumber(summary.deadlettersTotal)}, ${sqlString(JSON.stringify(run))});`,
      `DELETE FROM run_events WHERE run_id = ${sqlString(run.id)};`,
      `DELETE FROM run_metric_points WHERE run_id = ${sqlString(run.id)};`,
      `DELETE FROM run_schema_changes WHERE run_id = ${sqlString(run.id)};`,
      `DELETE FROM run_deadletters WHERE run_id = ${sqlString(run.id)};`,
      ...run.events.map(
        (event, index) =>
          `INSERT INTO run_events (run_id, event_index, event_name, timestamp, payload) VALUES (${sqlString(run.id)}, ${index}, ${sqlString(event.event)}, ${sqlNullable(event.timestamp)}, ${sqlString(JSON.stringify(event))});`
      ),
      ...run.metricPoints.map(
        (point, index) =>
          `INSERT INTO run_metric_points (run_id, point_index, timestamp, payload) VALUES (${sqlString(run.id)}, ${index}, ${sqlNullable(point.timestamp)}, ${sqlString(JSON.stringify(point))});`
      ),
      ...run.schemaChanges.map(
        (change, index) =>
          `INSERT INTO run_schema_changes (run_id, change_index, namespace, timestamp, payload) VALUES (${sqlString(run.id)}, ${index}, ${sqlString(change.namespace)}, ${sqlString(change.timestamp)}, ${sqlString(JSON.stringify(change))});`
      ),
      run.deadletters
        ? `INSERT OR REPLACE INTO run_deadletters (run_id, payload) VALUES (${sqlString(run.id)}, ${sqlString(JSON.stringify(run.deadletters))});`
        : "",
      `COMMIT;`
    ].filter(Boolean);
    await this.exec(statements.join("\n"));
  }

  async recentRuns(limit = 50): Promise<SkipprRunHistorySummary[]> {
    await this.init();
    return this.enqueue(async () => {
      const rows = await this.query<Array<{
        id: string;
        command: string;
        pipeline?: string;
        status: SkipprRunHistorySummary["status"];
        started_at: number;
        finished_at?: number;
        elapsed_ms?: number;
        total_rows?: number;
        freshness_iso?: string;
        deadletters_total?: number;
        payload?: string;
      }>>(`SELECT id, command, pipeline, status, started_at, finished_at, elapsed_ms, total_rows, freshness_iso, deadletters_total, payload FROM runs ORDER BY started_at DESC LIMIT ${limit};`);
      return rows.map((row) => {
        const parsed = parseRunPayload(row.payload);
        return parsed
          ? summarizeRun(parsed)
          : {
              id: row.id,
              command: row.command,
              runKind: row.command,
              label: row.command,
              pipeline: row.pipeline,
              status: row.status,
              startedAt: row.started_at,
              finishedAt: row.finished_at,
              elapsedMs: row.elapsed_ms,
              totalRows: row.total_rows,
              freshnessIso: row.freshness_iso,
              deadlettersTotal: row.deadletters_total
            };
      });
    });
  }

  async loadRun(id: string): Promise<SkipprObservedRun | undefined> {
    await this.init();
    return this.enqueue(async () => {
      const rows = await this.query<RunRow[]>(`SELECT id, payload FROM runs WHERE id = ${sqlString(id)} LIMIT 1;`);
      return parseRunPayload(rows[0]?.payload);
    });
  }

  private async ensureLocalIgnore(): Promise<void> {
    const skipprDir = path.join(this.workspaceRoot, ".skippr");
    await fs.mkdir(skipprDir, { recursive: true });
    const ignorePath = path.join(skipprDir, ".gitignore");
    try {
      const existing = await fs.readFile(ignorePath, "utf8");
      if (existing.split(/\r?\n/).some((line) => line.trim() === "ide/")) {
        return;
      }
      await fs.appendFile(ignorePath, `${existing.endsWith("\n") ? "" : "\n"}ide/\n`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await fs.writeFile(ignorePath, "ide/\n");
        return;
      }
      throw error;
    }
  }

  private async exec(sql: string): Promise<void> {
    await runSqlite(this.dbPath, sql, this.output);
  }

  private async query<T>(sql: string): Promise<T> {
    const stdout = await runSqlite(this.dbPath, `.mode json\n${sql}`, this.output);
    if (!stdout.trim()) {
      return [] as T;
    }
    return JSON.parse(stdout) as T;
  }
}

function parseRunPayload(payload: string | undefined): SkipprObservedRun | undefined {
  if (!payload) {
    return undefined;
  }
  try {
    return JSON.parse(payload) as SkipprObservedRun;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSqliteBusyError(message: string): boolean {
  return /database is locked|SQLITE_BUSY/i.test(message);
}

async function runSqlite(dbPath: string, sql: string, output: vscode.LogOutputChannel): Promise<string> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < SQLITE_BUSY_RETRIES; attempt += 1) {
    try {
      return await runSqliteOnce(dbPath, sql);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      if (!isSqliteBusyError(err.message) || attempt === SQLITE_BUSY_RETRIES - 1) {
        output.warn(`Skippr run history sqlite error: ${err.message}`);
        throw err;
      }
      await sleep(SQLITE_BUSY_BASE_MS * (attempt + 1));
    }
  }
  throw lastError ?? new Error("sqlite3 failed");
}

function runSqliteOnce(dbPath: string, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", [dbPath], { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(new Error(`sqlite3 is not available (${error.message})`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `sqlite3 exited with code ${code ?? "unknown"}`));
    });
    child.stdin.end(sql);
  });
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullable(value: string | undefined | null): string {
  return value === undefined || value === null ? "NULL" : sqlString(value);
}

function sqlNumber(value: number | undefined | null): string {
  return value === undefined || value === null || !Number.isFinite(value) ? "NULL" : String(Math.trunc(value));
}

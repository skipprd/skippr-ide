import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ApiRequestFn } from "./skipprRunApi";
import {
  listWorkspaceRuns,
  loadWorkspaceRun,
  putWorkspaceRun
} from "./skipprRunApi";
import { SkipprObservedRun, SkipprRunHistorySummary, summarizeRun } from "./skipprRunState";

const LOCAL_CACHE = "runs-cache.json";

interface LocalCacheFile {
  runs: SkipprObservedRun[];
}

export interface RunHistoryContext {
  apiRequest: ApiRequestFn;
  token: string;
  workspace: string;
}

export class SkipprRunHistory {
  private initialized = false;
  private cloud?: RunHistoryContext;

  constructor(
    private readonly workspaceRoot: string,
    private readonly output: vscode.LogOutputChannel,
    cloud?: RunHistoryContext
  ) {
    this.cloud = cloud;
  }

  setCloudContext(cloud: RunHistoryContext | undefined): void {
    this.cloud = cloud;
  }

  private get ideDir(): string {
    return path.join(this.workspaceRoot, ".skippr", "ide");
  }

  private get localCachePath(): string {
    return path.join(this.ideDir, LOCAL_CACHE);
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await fs.mkdir(this.ideDir, { recursive: true });
    await this.ensureLocalIgnore();
    this.initialized = true;
  }

  async saveRun(run: SkipprObservedRun): Promise<void> {
    await this.init();
    if (this.cloud) {
      try {
        await putWorkspaceRun(this.cloud.apiRequest, this.cloud.token, this.cloud.workspace, run);
      } catch (err) {
        this.output.warn(`Cloud run save failed, using local cache: ${String(err)}`);
      }
    }
    await this.saveRunLocalCache(run);
  }

  async recentRuns(limit = 50): Promise<SkipprRunHistorySummary[]> {
    await this.init();
    if (this.cloud) {
      try {
        return await listWorkspaceRuns(
          this.cloud.apiRequest,
          this.cloud.token,
          this.cloud.workspace,
          limit
        );
      } catch (err) {
        this.output.warn(`Cloud run list failed, using local cache: ${String(err)}`);
      }
    }
    return this.recentRunsLocal(limit);
  }

  async loadRun(id: string): Promise<SkipprObservedRun | undefined> {
    await this.init();
    if (this.cloud) {
      try {
        const remote = await loadWorkspaceRun(
          this.cloud.apiRequest,
          this.cloud.token,
          this.cloud.workspace,
          id
        );
        if (remote) {
          return remote;
        }
      } catch (err) {
        this.output.warn(`Cloud run load failed, using local cache: ${String(err)}`);
      }
    }
    return this.loadRunLocal(id);
  }

  private async saveRunLocalCache(run: SkipprObservedRun): Promise<void> {
    const cache = await this.readLocalCache();
    const idx = cache.runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) {
      cache.runs[idx] = run;
    } else {
      cache.runs.unshift(run);
    }
    cache.runs = cache.runs.slice(0, 100);
    await fs.writeFile(this.localCachePath, JSON.stringify(cache, null, 2), "utf8");
  }

  private async readLocalCache(): Promise<LocalCacheFile> {
    try {
      const raw = await fs.readFile(this.localCachePath, "utf8");
      return JSON.parse(raw) as LocalCacheFile;
    } catch {
      return { runs: [] };
    }
  }

  private async recentRunsLocal(limit: number): Promise<SkipprRunHistorySummary[]> {
    const cache = await this.readLocalCache();
    return cache.runs
      .slice(0, limit)
      .map((run) => summarizeRun(run));
  }

  private async loadRunLocal(id: string): Promise<SkipprObservedRun | undefined> {
    const cache = await this.readLocalCache();
    return cache.runs.find((r) => r.id === id);
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
}

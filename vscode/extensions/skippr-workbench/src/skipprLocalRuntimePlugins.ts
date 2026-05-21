import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  applyLocalRuntimePluginSpawnVars,
  mergeSkipprSpawnEnv,
  workspaceFolderForConfigPath
} from "./skipprEnv";
import { resolveSkipprdRepoRoot, useLocalSkipprdFromSettings } from "./skipprRunner";

const manifestBuilds = new Map<string, Promise<string | undefined>>();
const resolvedManifestDirs = new Map<string, string>();

export function useLocalRuntimePluginsFromSettings(): boolean {
  const conf = vscode.workspace.getConfiguration();
  if (conf.get<boolean>("skippr.dev.useLocalRuntimePlugins", true) === false) {
    return false;
  }
  if (process.env.SKIPPR_USE_LOCAL_RUNTIME_PLUGINS === "1") {
    return true;
  }
  if (process.env.SKIPPR_USE_LOCAL_RUNTIME_PLUGINS === "0") {
    return false;
  }
  return useLocalSkipprdFromSettings() || Boolean(resolveSkipprdRepoRoot());
}

function buildCacheKey(skipprdRoot: string, configPath: string, pipeline: string | undefined): string {
  return `${skipprdRoot}\0${configPath}\0${pipeline?.trim() ?? ""}`;
}

function localRuntimePluginsScript(skipprdRoot: string): string {
  return path.join(skipprdRoot, ".github", "scripts", "local_runtime_plugins.py");
}

function parseManifestDirFromStdout(stdout: string): string | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1);
  return last && path.isAbsolute(last) ? last : undefined;
}

async function runLocalRuntimePluginsBuild(
  skipprdRoot: string,
  configPath: string,
  pipeline: string | undefined,
  output?: vscode.LogOutputChannel
): Promise<string | undefined> {
  const script = localRuntimePluginsScript(skipprdRoot);
  if (!existsSync(script)) {
    output?.warn(`Local runtime plugin helper not found: ${script}`);
    return undefined;
  }

  const args = [script, "--config", configPath];
  const trimmedPipeline = pipeline?.trim();
  if (trimmedPipeline) {
    args.push("--pipeline", trimmedPipeline);
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Skippr: building local runtime plugins",
      cancellable: false
    },
    async () => {
      output?.info(`Building local runtime plugins for ${trimmedPipeline || "pipeline"}…`);
      const result = spawnSync("python3", args, {
        cwd: skipprdRoot,
        encoding: "utf8",
        env: process.env
      });
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || "local runtime plugin build failed").trim();
        output?.error(detail);
        throw new Error(detail);
      }
      const manifestDir = parseManifestDirFromStdout(result.stdout);
      if (!manifestDir || !existsSync(manifestDir)) {
        const detail = "local runtime plugin build did not produce a manifest directory";
        output?.error(detail);
        throw new Error(detail);
      }
      output?.info(`Local runtime plugins ready: ${manifestDir}`);
      return manifestDir;
    }
  );
}

/**
 * Build (or reuse cached) local runtime plugin manifests for the active config/pipeline.
 */
export async function ensureLocalRuntimePluginManifests(
  configPath: string,
  pipeline: string | undefined,
  output?: vscode.LogOutputChannel
): Promise<string | undefined> {
  if (!useLocalRuntimePluginsFromSettings()) {
    return undefined;
  }
  if (!pipeline?.trim()) {
    return undefined;
  }
  const skipprdRoot = resolveSkipprdRepoRoot();
  if (!skipprdRoot) {
    return undefined;
  }
  const trimmedConfig = configPath.trim();
  if (!trimmedConfig) {
    return undefined;
  }

  const cacheKey = buildCacheKey(skipprdRoot, trimmedConfig, pipeline);
  const cached = resolvedManifestDirs.get(cacheKey);
  if (cached) {
    return cached;
  }

  let pending = manifestBuilds.get(cacheKey);
  if (!pending) {
    pending = runLocalRuntimePluginsBuild(skipprdRoot, trimmedConfig, pipeline, output)
      .then((dir) => {
        if (dir) {
          resolvedManifestDirs.set(cacheKey, dir);
        }
        return dir;
      })
      .catch((error) => {
        manifestBuilds.delete(cacheKey);
        throw error;
      });
    manifestBuilds.set(cacheKey, pending);
  }
  return pending;
}

export function spawnEnvWithCachedLocalRuntimePlugins(
  base: NodeJS.ProcessEnv,
  configPath: string | undefined,
  pipeline: string | undefined
): NodeJS.ProcessEnv {
  const folder = workspaceFolderForConfigPath(configPath);
  const merged = mergeSkipprSpawnEnv(base, folder, pipeline, configPath);
  if (!useLocalRuntimePluginsFromSettings() || !configPath?.trim()) {
    return merged;
  }
  const skipprdRoot = resolveSkipprdRepoRoot();
  if (!skipprdRoot) {
    return merged;
  }
  const manifestDir = resolvedManifestDirs.get(buildCacheKey(skipprdRoot, configPath.trim(), pipeline));
  return manifestDir ? applyLocalRuntimePluginSpawnVars(merged, manifestDir) : merged;
}

export async function mergeSkipprSpawnEnvWithLocalRuntimePlugins(
  base: NodeJS.ProcessEnv,
  configPath: string | undefined,
  pipeline: string | undefined,
  output?: vscode.LogOutputChannel
): Promise<NodeJS.ProcessEnv> {
  const folder = workspaceFolderForConfigPath(configPath);
  const merged = mergeSkipprSpawnEnv(base, folder, pipeline, configPath);
  if (!useLocalRuntimePluginsFromSettings() || !configPath?.trim() || !pipeline?.trim()) {
    return merged;
  }
  try {
    const manifestDir = await ensureLocalRuntimePluginManifests(configPath, pipeline, output);
    return manifestDir ? applyLocalRuntimePluginSpawnVars(merged, manifestDir) : merged;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output?.error(`Skippr local runtime plugins: ${message}`);
    void vscode.window.showErrorMessage(
      "Skippr could not build local runtime plugins. See Skippr output for details."
    );
    return merged;
  }
}

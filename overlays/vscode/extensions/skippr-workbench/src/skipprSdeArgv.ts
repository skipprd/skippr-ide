import * as os from "node:os";
import * as path from "node:path";

export const PRODUCT_CLI = "sde";
export const LOCAL_CARGO_PACKAGE = "sde";

export type SkipprRunKind = "discover" | "sync-once" | "sync-all-once" | "sync" | "model";
export type PipelineScopedRunKind = Exclude<SkipprRunKind, "sync-all-once">;
export type PipelineName = string & { readonly __skipprPipelineName: unique symbol };

export function pipelineName(value: string): PipelineName | undefined {
  const trimmed = value.trim();
  return trimmed ? (trimmed as PipelineName) : undefined;
}

export function installedProductCliCandidates(): string[] {
  return [
    path.join(os.homedir(), ".skippr", "bin", PRODUCT_CLI),
    `/usr/local/bin/${PRODUCT_CLI}`,
    `/opt/homebrew/bin/${PRODUCT_CLI}`
  ];
}

interface BaseSkipprRunOptions {
  cliPath?: string;
  cwd: string;
  configPath: string;
  logLevel: string;
  extraArgs?: string[];
  spawnEnv?: NodeJS.ProcessEnv;
}

export type SkipprRunOptions =
  | (BaseSkipprRunOptions & {
      kind: PipelineScopedRunKind;
      pipeline: PipelineName;
      discoverOutput?: string;
      modelNoResume?: boolean;
    })
  | (BaseSkipprRunOptions & {
      kind: "sync-all-once";
    });

export function buildSdeRunArgs(options: SkipprRunOptions, projectRoot: string): string[] {
  const args: string[] = [];
  args.push("--config", options.configPath);
  if (options.logLevel.trim()) {
    args.push("--log", options.logLevel.trim());
  }

  if (options.kind === "discover") {
    args.push("discover");
    args.push("--pipeline", options.pipeline);
    const raw = (options.discoverOutput ?? "json").trim().toLowerCase();
    const out = raw === "progress" || raw === "json" || raw === "text" ? raw : "json";
    args.push("--output", out);
  } else if (options.kind === "model") {
    args.push("model");
    args.push("--pipeline", options.pipeline);
    args.push("--dbt-output-path", path.join(projectRoot, options.pipeline, "dbt"));
    if (options.modelNoResume) {
      args.push("--no-resume");
    }
    args.push("--output", "jsonl");
  } else if (options.kind === "sync-all-once") {
    args.push("sync", "--once", "--output", "json");
  } else {
    args.push("sync");
    args.push("--pipeline", options.pipeline);
    if (options.kind === "sync-once") {
      args.push("--once");
    }
    args.push("--output", "json");
  }
  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }
  return args;
}

export const INSTALL_SDE_ARGV = ["brew", "install", PRODUCT_CLI] as const;
export const UPGRADE_SDE_ARGV = ["brew", "upgrade", PRODUCT_CLI] as const;

export function buildLocalSdeCargoCommand(manifestPath: string, args: string[]): string[] {
  return ["cargo", "run", "--manifest-path", manifestPath, "-p", LOCAL_CARGO_PACKAGE, "--", ...args];
}

/** The `vector_sources` key and Lance scope the workspace index uses. */
export const VECTOR_INGEST_KEY = "vector_ingest";

export function buildVectorIngestArgs(configPath: string, srcPath: string, excludeGlobs: readonly string[]): string[] {
  return [
    "--config",
    configPath,
    "vector",
    "ingest-docs",
    "--vector-source",
    VECTOR_INGEST_KEY,
    "--pipeline",
    VECTOR_INGEST_KEY,
    "--src-path",
    srcPath,
    "--include-glob",
    "**/*",
    "--output",
    "json",
    ...excludeGlobs.flatMap((glob) => ["--exclude-glob", glob])
  ];
}

export function buildSdeMetadataApplyArgs(options: {
  configPath: string;
  logLevel: string;
  pipeline: string;
  namespace: string;
  schemaJson: string;
  evolved?: boolean;
  output?: string;
}): string[] {
  const args = [
    "--config",
    options.configPath,
    "--log",
    options.logLevel,
    "metadata",
    "apply",
    "--pipeline",
    options.pipeline,
    "--namespace",
    options.namespace,
    "--schema-json",
    options.schemaJson
  ];
  if (options.evolved !== false) {
    args.push("--evolved");
  }
  args.push("--output", options.output ?? "json");
  return args;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

export const SKIPPR_LOCAL_CARGO_CLI = '__skippr_local_cargo__';

/** Crates from react-cargo resolved via path when a local ../react checkout exists. */
const REACT_CARGO_PATCHES: ReadonlyArray<readonly [string, string]> = [
	['react', 'src/runtime'],
	['react-core', 'src/core'],
	['react-http-protocol', 'src/http-protocol'],
	['react-transport', 'src/transport'],
	['react-view', 'src/view'],
	['react-module-storage-s3', 'src/modules/adaptors/storage-s3'],
	['react-module-storage-local', 'src/modules/adaptors/storage-local'],
	['react-module-storage-memory', 'src/modules/adaptors/storage-memory'],
	['react-module-provider-vector-lance', 'src/modules/providers/vector-lance'],
	['react-suite-debugger', 'src/suites/suite_debugger'],
];

export function resolveLocalSkipprdManifest(extraCandidates: readonly string[] = []): string | undefined {
	const candidates = [
		process.env.SKIPPRD_MANIFEST_PATH,
		...extraCandidates,
		path.resolve(process.cwd(), 'skipprd/Cargo.toml'),
		path.resolve(process.cwd(), '../skipprd/Cargo.toml'),
		path.resolve(process.cwd(), '../../skipprd/Cargo.toml'),
		path.resolve(process.cwd(), '../../../skipprd/Cargo.toml'),
	].filter((candidate): candidate is string => Boolean(candidate?.trim()));
	return candidates.find(candidate => fs.existsSync(candidate));
}

export function resolveLocalReactRoot(skipprdManifestPath: string, extraSearchPaths: readonly string[] = []): string | undefined {
	const configured = process.env.SKIPPR_REACT_ROOT?.trim();
	if (configured && fs.existsSync(path.join(configured, 'Cargo.toml'))) {
		return path.resolve(configured);
	}
	const skipprdRoot = path.dirname(skipprdManifestPath);
	const candidates = [
		...extraSearchPaths,
		path.resolve(skipprdRoot, '../react'),
		path.resolve(skipprdRoot, '../../react'),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(path.join(candidate, 'Cargo.toml'))) {
			return candidate;
		}
	}
	return undefined;
}

export function reactCargoPatchConfigArgs(reactRoot: string): string[] {
	const args: string[] = [];
	for (const [crateName, relativePath] of REACT_CARGO_PATCHES) {
		const patchPath = path.resolve(reactRoot, relativePath);
		args.push('--config', `patch."react-cargo".${crateName}.path="${patchPath}"`);
	}
	return args;
}

export function resolveBuiltSkipprCli(skipprdManifestPath: string): string | undefined {
	const skipprdRoot = path.dirname(skipprdManifestPath);
	for (const name of ['skippr', 'skippr-cli']) {
		const candidate = path.join(skipprdRoot, 'target', 'debug', name);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

export function buildCargoRunArgs(skipprdManifestPath: string, skipprArgs: string[], reactRoot?: string): string[] {
	const argv: string[] = ['cargo', 'run', '--manifest-path', skipprdManifestPath];
	if (reactRoot) {
		argv.push(...reactCargoPatchConfigArgs(reactRoot));
	}
	argv.push('-p', 'skippr-cli', '--', ...skipprArgs);
	return argv;
}

export function resolveSkipprCliForIde(opts: {
	configuredPath?: string;
	preferLocalSkipprd: boolean;
	extraManifestCandidates?: readonly string[];
	extraReactSearchPaths?: readonly string[];
}): string {
	const configured = opts.configuredPath?.trim();
	if (configured) {
		return configured;
	}
	if (!opts.preferLocalSkipprd) {
		return 'skippr';
	}
	const manifest = resolveLocalSkipprdManifest(opts.extraManifestCandidates ?? []);
	if (!manifest) {
		return 'skippr';
	}
	const built = resolveBuiltSkipprCli(manifest);
	if (built) {
		return built;
	}
	return SKIPPR_LOCAL_CARGO_CLI;
}

export function buildSkipprCliInvocation(cliPath: string, args: string[], opts: {
	extraManifestCandidates?: readonly string[];
	extraReactSearchPaths?: readonly string[];
}): { command: string; argv: string[]; cwd?: string } {
	if (cliPath !== SKIPPR_LOCAL_CARGO_CLI) {
		return { command: cliPath, argv: args };
	}
	const manifest = resolveLocalSkipprdManifest(opts.extraManifestCandidates ?? []);
	if (!manifest) {
		return { command: 'skippr', argv: args };
	}
	const reactRoot = resolveLocalReactRoot(manifest, opts.extraReactSearchPaths ?? []);
	return {
		command: 'cargo',
		argv: buildCargoRunArgs(manifest, args, reactRoot),
		cwd: path.dirname(manifest),
	};
}

export function reactCargoAuthHint(): string {
	return (
		'Skippr could not fetch React crates from the private react-cargo registry. ' +
		'Place a sibling ../react checkout next to skipprd, set SKIPPR_REACT_ROOT, run ' +
		'`cargo build -p skippr-cli` once from skipprd (path patches apply automatically in the IDE), ' +
		'or export CARGO_REGISTRIES_REACT_CARGO_TOKEN (see skipprd/docs/docs/maintainers/local-development.md).'
	);
}

export function enrichCargoFailureDetail(detail: string | undefined, stderrHint?: string): string | undefined {
	const combined = [detail, stderrHint].filter((part): part is string => Boolean(part?.trim())).join('\n');
	if (!combined.includes('react-cargo')) {
		return detail;
	}
	return `${combined}\n${reactCargoAuthHint()}`;
}

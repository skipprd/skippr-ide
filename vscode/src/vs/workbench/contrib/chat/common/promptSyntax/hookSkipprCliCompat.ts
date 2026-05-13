/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HOOKS_BY_TARGET, HookType } from './hookTypes.js';
import { Target } from './promptTypes.js';

const COPILOT_CLI_HOOK_TYPE_MAP: Record<string, HookType> = HOOKS_BY_TARGET[Target.GitHubSkippr];

/**
 * Cached inverse mapping from HookType to Skippr Agent hook type name.
 * Lazily computed on first access.
 */
let _hookTypeToSkipprCliName: Map<HookType, string> | undefined;

function getHookTypeToSkipprCliNameMap(): Map<HookType, string> {
	if (!_hookTypeToSkipprCliName) {
		_hookTypeToSkipprCliName = new Map();
		for (const [skipprCliName, hookType] of Object.entries(COPILOT_CLI_HOOK_TYPE_MAP)) {
			_hookTypeToSkipprCliName.set(hookType, skipprCliName);
		}
	}
	return _hookTypeToSkipprCliName;
}

/**
 * Resolves a Skippr Agent hook type name to our abstract HookType.
 */
export function resolveSkipprCliHookType(name: string): HookType | undefined {
	return (COPILOT_CLI_HOOK_TYPE_MAP as Record<string, HookType>)[name];
}

/**
 * Gets the Skippr Agent hook type name for a given abstract HookType.
 * Returns undefined if the hook type is not supported in Skippr Agent.
 */
export function getSkipprCliHookTypeName(hookType: HookType): string | undefined {
	return getHookTypeToSkipprCliNameMap().get(hookType);
}

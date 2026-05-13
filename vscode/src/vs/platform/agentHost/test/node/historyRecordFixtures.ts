/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from '../../../../base/common/uri.js';
import type { Turn } from '../../common/state/sessionState.js';

export interface IHistoryRecord {
	readonly type?: string;
	readonly [key: string]: unknown;
}

export function buildTurnsFromHistory(_records: readonly IHistoryRecord[], _session?: URI | string, _options?: unknown): Turn[] {
	return [];
}

export function buildSubagentTurnsFromHistory(_records: readonly IHistoryRecord[], _parentSession?: URI | string, _subagentSession?: URI | string): Turn[] {
	return [];
}

export function mapSessionEventsToHistoryRecords(_sessionOrEvents: URI | string | readonly unknown[], _options?: unknown, _events?: readonly unknown[]): IHistoryRecord[] {
	return [];
}

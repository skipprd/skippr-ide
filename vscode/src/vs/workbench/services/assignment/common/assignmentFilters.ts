/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IExperimentationFilterProvider } from 'tas-client';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

export enum ExtensionsFilter { }

export class SkipprAssignmentFilterProvider extends Disposable implements IExperimentationFilterProvider {
	readonly onDidChangeFilters = Event.None;

	constructor() {
		super();
	}

	getFilterValue(filter: string): string | null {
		return null;
	}

	getFilters(): Map<string, string | null> {
		const filters = new Map<string, string | null>();
		const filterValues = Object.values(ExtensionsFilter);
		for (const value of filterValues) {
			filters.set(value, this.getFilterValue(value));
		}

		return filters;
	}
}

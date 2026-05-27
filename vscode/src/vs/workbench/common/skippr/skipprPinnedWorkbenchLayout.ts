/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Skippr. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ViewContainer } from '../views.js';

export const SKIPPR_EXTENSION_VIEW_CONTAINER_PREFIX = 'workbench.view.extension.';

export const SKIPPR_ACTIVITY_BAR_CONTAINER_MANIFEST_IDS = [
	'skipprConnectionsActivity',
	'skipprLineageActivity',
	'skippr.dashboards.activity',
] as const;

export const SKIPPR_RUN_PANEL_CONTAINER_MANIFEST_IDS = [
	'skippr.run.timeline.panel',
	'skippr.query.results.panel',
	'skippr.run.deadletters.panel',
] as const;

export const SKIPPR_PINNED_ACTIVITY_VIEW_IDS = [
	'skippr.connections',
	'skippr.lineageLaunch',
	'skippr.dashboards',
] as const;

export function skipprExtensionViewContainerId(manifestId: string): string {
	return `${SKIPPR_EXTENSION_VIEW_CONTAINER_PREFIX}${manifestId}`;
}

export function skipprViewContainerLookupIds(manifestId: string): string[] {
	return [skipprExtensionViewContainerId(manifestId), manifestId];
}

export function isSkipprPinnedActivityBarContainer(viewContainerId: string): boolean {
	return SKIPPR_ACTIVITY_BAR_CONTAINER_MANIFEST_IDS.some(id =>
		viewContainerId === id || viewContainerId === skipprExtensionViewContainerId(id));
}

export function isSkipprPinnedRunPanelContainer(viewContainerId: string): boolean {
	return SKIPPR_RUN_PANEL_CONTAINER_MANIFEST_IDS.some(id =>
		viewContainerId === id || viewContainerId === skipprExtensionViewContainerId(id));
}

export function isSkipprProductOwnedContainer(viewContainerId: string): boolean {
	return isSkipprPinnedActivityBarContainer(viewContainerId) || isSkipprPinnedRunPanelContainer(viewContainerId);
}

export function isSkipprPinnedActivityView(viewId: string): boolean {
	return (SKIPPR_PINNED_ACTIVITY_VIEW_IDS as readonly string[]).includes(viewId);
}

export function forEachSkipprPinnedContainerManifestId(fn: (manifestId: string) => void): void {
	for (const id of SKIPPR_ACTIVITY_BAR_CONTAINER_MANIFEST_IDS) {
		fn(id);
	}
	for (const id of SKIPPR_RUN_PANEL_CONTAINER_MANIFEST_IDS) {
		fn(id);
	}
}

export function forEachSkipprPinnedContainerStorageId(fn: (containerId: string) => void): void {
	forEachSkipprPinnedContainerManifestId(manifestId => {
		for (const id of skipprViewContainerLookupIds(manifestId)) {
			fn(id);
		}
	});
}

export function getSkipprViewContainerByManifestId(
	getViewContainerById: (id: string) => ViewContainer | null,
	manifestId: string,
): ViewContainer | null {
	for (const id of skipprViewContainerLookupIds(manifestId)) {
		const container = getViewContainerById(id);
		if (container) {
			return container;
		}
	}
	return null;
}

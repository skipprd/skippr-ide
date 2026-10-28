export const SKIPPR_ACTIVITY_BAR_CONTAINER_MANIFEST_IDS = ["skipprConnectionsActivity"] as const;

export const SKIPPR_RUN_PANEL_CONTAINER_MANIFEST_IDS = [
  "skippr.run.timeline.panel",
  "skippr.run.deadletters.panel",
  "skippr.query.results.panel",
  "skippr.lineage.panel",
  "skippr.dashboards.panel"
] as const;

export const SKIPPR_PINNED_ACTIVITY_VIEW_IDS = ["skippr.connections"] as const;

const PRODUCT_OWNED_CONTAINERS = new Set<string>([
  ...SKIPPR_ACTIVITY_BAR_CONTAINER_MANIFEST_IDS,
  ...SKIPPR_RUN_PANEL_CONTAINER_MANIFEST_IDS
]);

const PINNED_ACTIVITY_VIEWS = new Set<string>(SKIPPR_PINNED_ACTIVITY_VIEW_IDS);

export function getSkipprViewContainerByManifestId<T>(
  lookup: (id: string) => T | undefined,
  manifestId: string
): T | undefined {
  return lookup(manifestId);
}

export function isSkipprPinnedActivityView(viewId: string): boolean {
  return PINNED_ACTIVITY_VIEWS.has(viewId);
}

export function isSkipprProductOwnedContainer(id: string): boolean {
  return PRODUCT_OWNED_CONTAINERS.has(id);
}

export function isSkipprPinnedActivityBarContainer(id: string): boolean {
  return (SKIPPR_ACTIVITY_BAR_CONTAINER_MANIFEST_IDS as readonly string[]).includes(id);
}

export function isSkipprPinnedRunPanelContainer(id: string): boolean {
  return (SKIPPR_RUN_PANEL_CONTAINER_MANIFEST_IDS as readonly string[]).includes(id);
}

export function forEachSkipprPinnedContainerStorageId(fn: (containerId: string) => void): void {
  for (const id of PRODUCT_OWNED_CONTAINERS) {
    fn(id);
  }
}

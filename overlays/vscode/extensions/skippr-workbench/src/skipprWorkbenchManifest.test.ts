import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

const packageJsonPath = path.join(__dirname, "..", "package.json");

function contributeKeyHits(raw: string, key: string): number {
  const re = new RegExp(`^\\s+"${key}":`, "gm");
  return (raw.match(re) ?? []).length;
}

test("package.json contributes has one configuration and one submenus", () => {
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  assert.equal(contributeKeyHits(raw, "configuration"), 1);
  assert.equal(contributeKeyHits(raw, "submenus"), 1);
});

test("JSON.parse keeps business theme and SQL run-mode submenu", () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    contributes: {
      configuration: { properties: Record<string, unknown> };
      submenus: Array<{ id: string }>;
    };
  };
  assert.ok(pkg.contributes.configuration.properties["skippr.businessUser.forceLightTheme"]);
  const submenuIds = pkg.contributes.submenus.map((s) => s.id);
  assert.ok(submenuIds.includes("skippr.sql.runMode"));
  assert.ok(submenuIds.includes("skippr.pipelineRun"));
});

test("Lineage and Dashboards default to bottom panel; Connections stay in activity bar", () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    contributes: {
      viewsContainers: { activitybar?: Array<{ id: string }>; panel?: Array<{ id: string }> };
      views: Record<string, unknown>;
    };
  };
  const activityIds = (pkg.contributes.viewsContainers.activitybar ?? []).map((c) => c.id);
  const panelIds = (pkg.contributes.viewsContainers.panel ?? []).map((c) => c.id);
  assert.deepEqual(activityIds, ["skipprConnectionsActivity"]);
  assert.ok(panelIds.includes("skippr.lineage.panel"));
  assert.ok(panelIds.includes("skippr.dashboards.panel"));
  assert.ok(panelIds.includes("skippr.run.timeline.panel"));
  assert.ok("skippr.lineage.panel" in pkg.contributes.views);
  assert.ok("skippr.dashboards.panel" in pkg.contributes.views);
  assert.ok(!("skipprLineageActivity" in pkg.contributes.views));
  assert.ok(!("skippr.dashboards.activity" in pkg.contributes.views));
  assert.ok(!("debug" in pkg.contributes.views));
});

test("Lineage graph lives in the lineage panel", () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    contributes: { views: Record<string, Array<{ id: string }>> };
  };
  const lineageIds = (pkg.contributes.views["skippr.lineage.panel"] ?? []).map((v) => v.id);
  assert.ok(lineageIds.includes("skippr.lineageLaunch"));
  assert.ok(lineageIds.includes("skippr.lineageGraph"));
});

test("run details timeline uses described events, not a second label map", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "skipprRunDetailsPanelHtml.ts"),
    "utf8"
  );
  assert.equal(html.includes("modelEventLabel"), false);
  assert.equal(html.includes("function eventDetail"), false);
  assert.equal(html.includes("modelEventDetail"), false);
  assert.ok(html.includes("e.description"));
});

test("dead rustBridge overlay module is gone", () => {
  const srcDir = path.join(__dirname, "..", "src");
  assert.equal(fs.existsSync(path.join(srcDir, "rustBridge.ts")), false);
});

test("pipeline run submenu is on the skippr.yml editor context menu", () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    contributes: {
      menus: Record<string, Array<{ submenu?: string; command?: string; when?: string }>>;
    };
  };
  const editorContext = pkg.contributes.menus["editor/context"] ?? [];
  const pipelineItem = editorContext.find((item) => item.submenu === "skippr.pipelineRun");
  assert.ok(pipelineItem);
  assert.match(pipelineItem!.when ?? "", /skippr\.ya\?ml/);
  const debugToolbar = pkg.contributes.menus["skippr.debug.toolbar"] ?? [];
  assert.ok(debugToolbar.some((item) => item.submenu === "skippr.pipelineRun"));
  assert.equal(
    debugToolbar.some((item) => item.command === "skippr.run.pickPipelineAction"),
    false
  );
});

test("skippr.showPipelineRunMenu is registered in overlay source", () => {
  const srcDir = path.join(__dirname, "..", "src");
  const menuSrc = fs.readFileSync(path.join(srcDir, "skipprPipelineActionMenu.ts"), "utf8");
  assert.ok(menuSrc.includes('"skippr.showPipelineRunMenu"'));
  assert.ok(menuSrc.includes("registerCommand"));
  const extensionSrc = fs.readFileSync(path.join(srcDir, "extension.ts"), "utf8");
  assert.ok(extensionSrc.includes("registerSkipprPipelineRunMenu(context)"));
  assert.ok(extensionSrc.includes('new SkipprPipelineCodeLensProvider("skippr.run.lensWithArgs", "skippr.showPipelineRunMenu")'));
  assert.equal(extensionSrc.includes("skippr.run.pickPipelineAction"), false);
  assert.equal(extensionSrc.includes("skippr.open.discover"), false);
  assert.equal(extensionSrc.includes("skippr.open.sync"), false);
  assert.equal(extensionSrc.includes("skippr.open.model"), false);
});

test("active-run conflict focuses the run timeline", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "extension.ts"), "utf8");
  const start = src.indexOf("if (activeRun) {");
  const end = src.indexOf("const skipModal", start);
  assert.ok(start >= 0 && end > start);
  const slice = src.slice(start, end);
  assert.ok(slice.includes("Attached to active"));
  assert.ok(slice.includes("Skippr is already running:"));
  assert.equal(slice.split("revealSkipprRunPanel()").length - 1, 2);
  assert.equal(slice.includes("output.show(true)"), false);
});

test("Discover/Sync activity stubs and pickPipelineAction are gone", () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    contributes: { commands: Array<{ command: string }> };
  };
  const ids = pkg.contributes.commands.map((c) => c.command);
  assert.equal(ids.includes("skippr.open.discover"), false);
  assert.equal(ids.includes("skippr.open.sync"), false);
  assert.equal(ids.includes("skippr.open.model"), false);
  assert.equal(ids.includes("skippr.run.pickPipelineAction"), false);
  assert.equal(ids.includes("skippr.cloud.open"), false);
  assert.equal(ids.includes("skippr.cloud.create"), false);
  assert.ok(ids.includes("skippr.showPipelineRunMenu"));
  assert.ok(ids.includes("skippr.run.discoverPipeline"));
});

test("in-context product commands stay off the command palette", () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    contributes: { menus: { commandPalette: Array<{ command: string; when?: string }> } };
  };
  const hidden = new Set(
    (pkg.contributes.menus.commandPalette ?? [])
      .filter((item) => item.when === "false")
      .map((item) => item.command)
  );
  for (const id of [
    "skippr.dashboard.create",
    "skippr.dashboard.addFromTable",
    "skippr.dashboard.addFromEditor",
    "skippr.dashboard.modelForDashboard",
    "skippr.sql.setRunModeSql",
    "skippr.sql.setRunModeTests",
    "skippr.sql.askDataQuestion",
    "skippr.sql.runSelection",
    "skippr.sql.runDocument",
    "skippr.sql.runDbtDocument",
    "skippr.showPipelineRunMenu",
    "skippr.run.doctor",
    "skippr.run.stopSyncPipeline",
    "skippr.file.newCloudWorkspace",
    "skippr.file.openCloudWorkspace",
    "skippr.schemaDiff.openReview",
    "skippr.open.lineage"
  ]) {
    assert.ok(hidden.has(id), id);
  }
});

test("pinned layout container ids match workbench package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    contributes: {
      viewsContainers: { activitybar?: Array<{ id: string }>; panel?: Array<{ id: string }> };
    };
  };
  const layoutPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "src",
    "vs",
    "workbench",
    "common",
    "skippr",
    "skipprPinnedWorkbenchLayout.ts"
  );
  const layoutSrc = fs.readFileSync(layoutPath, "utf8");
  const activityIds = (pkg.contributes.viewsContainers.activitybar ?? []).map((c) => c.id);
  const panelIds = (pkg.contributes.viewsContainers.panel ?? []).map((c) => c.id);
  assert.deepEqual(activityIds, ["skipprConnectionsActivity"]);
  assert.deepEqual(panelIds, [
    "skippr.run.timeline.panel",
    "skippr.run.deadletters.panel",
    "skippr.query.results.panel",
    "skippr.lineage.panel",
    "skippr.dashboards.panel"
  ]);
  for (const id of [...activityIds, ...panelIds, "skippr.connections"]) {
    assert.ok(layoutSrc.includes(`"${id}"`), id);
  }
});

test("local sde cargo setting is not named for skipprd", () => {
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw) as {
    contributes: { configuration: { properties: Record<string, unknown> } };
  };
  assert.ok(pkg.contributes.configuration.properties["skippr.dev.useLocalSde"]);
  assert.equal(pkg.contributes.configuration.properties["skippr.dev.useLocalSkipprd"], undefined);
  assert.equal(raw.includes("useLocalSkipprd"), false);
  assert.equal(raw.includes("skippr-cli"), false);
});

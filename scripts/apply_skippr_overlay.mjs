import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = path.join(rootDir, "vscode");
const overlayDir = path.join(rootDir, "overlays", "vscode");
const productOverridesPath = path.join(rootDir, "config", "product.overrides.json");

if (!existsSync(vscodeDir)) {
  throw new Error("vscode source tree not found. Run scripts/bootstrap_vscode_fork.sh first.");
}

if (!existsSync(overlayDir)) {
  throw new Error("overlay directory missing.");
}

cpSync(overlayDir, vscodeDir, { recursive: true, force: true });

const productPath = path.join(vscodeDir, "product.json");
const product = JSON.parse(readFileSync(productPath, "utf8"));
const overrides = JSON.parse(readFileSync(productOverridesPath, "utf8"));
Object.assign(product, overrides);
writeFileSync(productPath, `${JSON.stringify(product, null, 2)}\n`, "utf8");

const extensionsRoot = path.join(vscodeDir, "extensions");
if (!existsSync(extensionsRoot)) {
  mkdirSync(extensionsRoot, { recursive: true });
}

const extensionsContributionPath = path.join(
  vscodeDir,
  "src",
  "vs",
  "workbench",
  "contrib",
  "extensions",
  "browser",
  "extensions.contribution.ts"
);
const extensionsContributionSource = readFileSync(extensionsContributionPath, "utf8");
const extensionMenuNeedle = "when: IsSessionsWindowContext.negate()";
if (extensionsContributionSource.includes(extensionMenuNeedle)) {
  writeFileSync(
    extensionsContributionPath,
    extensionsContributionSource.replace(extensionMenuNeedle, "when: ContextKeyExpr.false()"),
    "utf8"
  );
}

const globalActivityNeedle = "order: 3\n\t\t}));";
if (readFileSync(extensionsContributionPath, "utf8").includes(globalActivityNeedle)) {
  writeFileSync(
    extensionsContributionPath,
    readFileSync(extensionsContributionPath, "utf8").replace(globalActivityNeedle, "order: 3,\n\t\t\twhen: ContextKeyExpr.false()\n\t\t}));"),
    "utf8"
  );
}

const debugContributionPath = path.join(vscodeDir, "src", "vs", "workbench", "contrib", "debug", "browser", "debug.contribution.ts");
const debugContributionSource = readFileSync(debugContributionPath, "utf8");
if (!debugContributionSource.includes("miSkipprDiscover")) {
  const runMenuBlock = `MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
\tgroup: '1_debug',
\tcommand: {
\t\tid: DEBUG_RUN_COMMAND_ID,
\t\ttitle: nls.localize({ key: 'miRun', comment: ['&& denotes a mnemonic'] }, "Run &&Without Debugging")
\t},
\torder: 2,
\twhen: CONTEXT_DEBUGGERS_AVAILABLE
});`;
  const skipprRunBlock = `${runMenuBlock}

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
\tgroup: '1_skippr',
\tcommand: {
\t\tid: 'skippr.run.discoverPipeline',
\t\ttitle: nls.localize({ key: 'miSkipprDiscover', comment: ['&& denotes a mnemonic'] }, "Skippr &&Discover")
\t},
\torder: 10
});

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
\tgroup: '1_skippr',
\tcommand: {
\t\tid: 'skippr.run.syncPipelineOnce',
\t\ttitle: nls.localize({ key: 'miSkipprSync', comment: ['&& denotes a mnemonic'] }, "Skippr &&Sync")
\t},
\torder: 11
});

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
\tgroup: '1_skippr',
\tcommand: {
\t\tid: 'skippr.open.model',
\t\ttitle: nls.localize({ key: 'miSkipprModel', comment: ['&& denotes a mnemonic'] }, "Skippr &&Model")
\t},
\torder: 12
});`;
  writeFileSync(debugContributionPath, debugContributionSource.replace(runMenuBlock, skipprRunBlock), "utf8");
}

const macMenubarPath = path.join(vscodeDir, "src", "vs", "platform", "menubar", "electron-main", "menubar.ts");
const macMenubarSource = readFileSync(macMenubarPath, "utf8");
if (!macMenubarSource.includes("miSkipprDiscover")) {
  const preferencesBlock = `\t\tif (preferences) {
\t\t\tactions.push(...[
\t\t\t\t__separator__(),
\t\t\t\tpreferences
\t\t\t]);
\t\t}`;
  const skipprMacBlock = `${preferencesBlock}

\t\tactions.push(...[
\t\t\t__separator__(),
\t\t\tthis.createMenuItem(nls.localize({ key: 'miSkipprDiscover', comment: ['&& denotes a mnemonic'] }, "Skippr &&Discover"), 'skippr.run.discoverPipeline'),
\t\t\tthis.createMenuItem(nls.localize({ key: 'miSkipprSync', comment: ['&& denotes a mnemonic'] }, "Skippr &&Sync"), 'skippr.run.syncPipelineOnce'),
\t\t\tthis.createMenuItem(nls.localize({ key: 'miSkipprModel', comment: ['&& denotes a mnemonic'] }, "Skippr &&Model"), 'skippr.open.model')
\t\t]);`;
  writeFileSync(macMenubarPath, macMenubarSource.replace(preferencesBlock, skipprMacBlock), "utf8");
}

for (const sourcePath of [debugContributionPath, macMenubarPath]) {
  const source = readFileSync(sourcePath, "utf8");
  const updated = source
    .replaceAll("'skippr.open.discover'", "'skippr.run.discoverPipeline'")
    .replaceAll("'skippr.open.sync'", "'skippr.run.syncPipelineOnce'");
  if (updated !== source) {
    writeFileSync(sourcePath, updated, "utf8");
  }
}

console.log("Skippr overlay applied successfully.");

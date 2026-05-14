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
\t\tid: 'skippr.run.modelPipeline',
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
\t\t\tthis.createMenuItem(nls.localize({ key: 'miSkipprModel', comment: ['&& denotes a mnemonic'] }, "Skippr &&Model"), 'skippr.run.modelPipeline')
\t\t]);`;
  writeFileSync(macMenubarPath, macMenubarSource.replace(preferencesBlock, skipprMacBlock), "utf8");
}

for (const sourcePath of [debugContributionPath, macMenubarPath]) {
  const source = readFileSync(sourcePath, "utf8");
  const updated = source
    .replaceAll("'skippr.open.discover'", "'skippr.run.discoverPipeline'")
    .replaceAll("'skippr.open.sync'", "'skippr.run.syncPipelineOnce'")
    .replaceAll("'skippr.open.model'", "'skippr.run.modelPipeline'");
  if (updated !== source) {
    writeFileSync(sourcePath, updated, "utf8");
  }
}

const globalCompositeBarPath = path.join(vscodeDir, "src", "vs", "workbench", "browser", "parts", "globalCompositeBar.ts");
let globalCompositeBarSource = readFileSync(globalCompositeBarPath, "utf8");
globalCompositeBarSource = globalCompositeBarSource
  .replace(
    "import { AuthenticationSessionAccount, IAuthenticationService, INTERNAL_AUTH_PROVIDER_PREFIX } from '../../services/authentication/common/authentication.js';",
    "import { AuthenticationSessionAccount, IAuthenticationService } from '../../services/authentication/common/authentication.js';"
  )
  .replace(
    "const providers = this.authenticationService.getProviderIds().filter(p => !p.startsWith(INTERNAL_AUTH_PROVIDER_PREFIX));",
    "const providers = this.authenticationService.getProviderIds().filter(p => p === 'skippr');"
  )
  .replace(
    "const canUseMcp = !!provider.authorizationServers?.length;",
    "const canUseMcp = providerId !== 'skippr' && !!provider.authorizationServers?.length;"
  )
  .replace(
    `\t\t\t\tfor (const account of accounts) {
\t\t\t\t\tconst manageExtensionsAction = toAction({`,
    `\t\t\t\tfor (const account of accounts) {
\t\t\t\t\tif (providerId === 'skippr') {
\t\t\t\t\t\tconst providerSubMenuActions: IAction[] = [
\t\t\t\t\t\t\ttoAction({
\t\t\t\t\t\t\t\tid: 'skipprAccount',
\t\t\t\t\t\t\t\tlabel: localize('skipprAccount', "Skippr Account"),
\t\t\t\t\t\t\t\tenabled: true,
\t\t\t\t\t\t\t\trun: () => this.commandService.executeCommand('skippr.auth.account')
\t\t\t\t\t\t\t})
\t\t\t\t\t\t];
\t\t\t\t\t\tif (account.canSignOut) {
\t\t\t\t\t\t\tproviderSubMenuActions.push(toAction({
\t\t\t\t\t\t\t\tid: 'skipprSignOut',
\t\t\t\t\t\t\t\tlabel: localize('skipprSignOut', "Sign Out"),
\t\t\t\t\t\t\t\tenabled: true,
\t\t\t\t\t\t\t\trun: () => this.commandService.executeCommand('skippr.auth.signOut')
\t\t\t\t\t\t\t}));
\t\t\t\t\t\t}
\t\t\t\t\t\tmenus.push(new SubmenuAction('activitybar.submenu', \`\${account.label} (\${provider.label})\`, providerSubMenuActions));
\t\t\t\t\t\tcontinue;
\t\t\t\t\t}

\t\t\t\t\tconst manageExtensionsAction = toAction({`
  )
  .replace(
    `\t\t\tfor (const providerId of dynamicProviders) {
\t\t\t\tconst provider = this.authenticationService.getProvider(providerId);`,
    `\t\t\tfor (const providerId of dynamicProviders) {
\t\t\t\tconst provider = this.authenticationService.getProvider(providerId);`
  )
  .replace(
    `\t\t\t}
\t\t}

\t\tif (menus.length && otherCommands.length) {`,
    `\t\t\t}

\t\t\tif (!menus.length) {
\t\t\t\tmenus.push(toAction({
\t\t\t\t\tid: 'skipprSignIn',
\t\t\t\t\tlabel: localize('skipprSignIn', "Sign in to Skippr"),
\t\t\t\t\tenabled: true,
\t\t\t\t\trun: () => this.commandService.executeCommand('skippr.auth.account')
\t\t\t\t}));
\t\t\t}
\t\t}

\t\tconst skipprCommands = otherCommands
\t\t\t.map(group => [group[0], group[1].filter(action => action.id.startsWith('skippr.'))] as const)
\t\t\t.filter(group => group[1].length);

\t\tif (menus.length && skipprCommands.length) {`
  )
  .replace(
    `\t\totherCommands.forEach((group, i) => {
\t\t\tconst actions = group[1];
\t\t\tmenus = menus.concat(actions);
\t\t\tif (i !== otherCommands.length - 1) {
\t\t\t\tmenus.push(new Separator());
\t\t\t}
\t\t});`,
    `\t\tskipprCommands.forEach((group, i) => {
\t\t\tconst actions = group[1];
\t\t\tmenus = menus.concat(actions);
\t\t\tif (i !== skipprCommands.length - 1) {
\t\t\t\tmenus.push(new Separator());
\t\t\t}
\t\t});`
  );
writeFileSync(globalCompositeBarPath, globalCompositeBarSource, "utf8");

const chatContributionPath = path.join(vscodeDir, "src", "vs", "workbench", "contrib", "chat", "browser", "chat.contribution.ts");
let chatContributionSource = readFileSync(chatContributionPath, "utf8");
chatContributionSource = chatContributionSource
  .replaceAll("Enable session sync to GitHub.com. When enabled, Skippr session data is synced to your GitHub account", "Enable session sync to Skippr. When enabled, Skippr session data is synced to your Skippr account")
  .replaceAll("Enable session sync to GitHub.com for cross-device Skippr session history.", "Enable session sync to Skippr for cross-device Skippr session history.")
  .replaceAll("List of GitHub organization logins whose members are permitted to use AI features. When set to a non-empty list, AI features are disabled until the user signs into a GitHub account that belongs to one of the specified organizations and account-level policy data has been resolved. Set to '*' to allow any authenticated GitHub or GitHub Enterprise account.", "List of Skippr organization identifiers whose members are permitted to use AI features. When set to a non-empty list, AI features are disabled until the user signs into a Skippr account that belongs to one of the specified organizations and account-level policy data has been resolved. Set to '*' to allow any authenticated Skippr account.")
  .replaceAll("Setting this policy to a non-empty list activates the Approved Account gate: all AI features are disabled until the user signs into a GitHub account whose organizations intersect this list AND the account-side policy data has resolved. Comparison is case-insensitive. Use '*' as a wildcard to accept any signed-in GitHub or GHE account (use this for GHE deployments where the organization list is not surfaced).", "Setting this policy to a non-empty list activates the Approved Account gate: all AI features are disabled until the user signs into a Skippr account whose organizations intersect this list AND the account-side policy data has resolved. Comparison is case-insensitive. Use '*' as a wildcard to accept any signed-in Skippr account.");
writeFileSync(chatContributionPath, chatContributionSource, "utf8");

const chatExecuteActionsPath = path.join(vscodeDir, "src", "vs", "workbench", "contrib", "chat", "browser", "actions", "chatExecuteActions.ts");
let chatExecuteActionsSource = readFileSync(chatExecuteActionsPath, "utf8");
chatExecuteActionsSource = chatExecuteActionsSource.replace(
  `\t\t\tmenu: [
\t\t\t\t{
\t\t\t\t\tid: MenuId.ChatInput,
\t\t\t\t\torder: 1,
\t\t\t\t\twhen: ContextKeyExpr.and(
\t\t\t\t\t\tChatContextKeys.enabled,
\t\t\t\t\t\tChatContextKeys.location.isEqualTo(ChatAgentLocation.Chat),
\t\t\t\t\t\tChatContextKeys.inQuickChat.negate(),
\t\t\t\t\t\tContextKeyExpr.or(
\t\t\t\t\t\t\tChatContextKeys.lockedToCodingAgent.negate(),
\t\t\t\t\t\t\tChatContextKeys.chatSessionHasCustomAgentTarget),
\t\t\t\t\t\t// Show in welcome view for local sessions or sessions with custom agent target
\t\t\t\t\t\tContextKeyExpr.or(
\t\t\t\t\t\t\tChatContextKeys.inAgentSessionsWelcome.negate(),
\t\t\t\t\t\t\tChatContextKeys.chatSessionHasCustomAgentTarget,
\t\t\t\t\t\t\tChatContextKeys.agentSessionType.isEqualTo(AgentSessionProviders.Local))),
\t\t\t\t\tgroup: 'navigation',
\t\t\t\t},
\t\t\t]`,
  ""
);
writeFileSync(chatExecuteActionsPath, chatExecuteActionsSource, "utf8");

const chatWidgetPath = path.join(vscodeDir, "src", "vs", "workbench", "contrib", "chat", "browser", "widget", "chatWidget.ts");
let chatWidgetSource = readFileSync(chatWidgetPath, "utf8");
chatWidgetSource = chatWidgetSource
  .replace("Disposable, DisposableStore, IDisposable, MutableDisposable, thenIfNotDisposed", "Disposable, DisposableStore, IDisposable, MutableDisposable")
  .replace("import { IPromptsService, PromptsStorage } from '../../common/promptSyntax/service/promptsService.js';", "import { PromptsStorage } from '../../common/promptSyntax/service/promptsService.js';")
  .replace("import { GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID, handleModeSwitch } from '../actions/chatActions.js';", "import { handleModeSwitch } from '../actions/chatActions.js';")
  .replace(`\t\t@IPromptsService private readonly promptsService: IPromptsService,\n`, "")
  .replace(`\n\tprivate _instructionFilesCheckPromise: Promise<boolean> | undefined;\n\tprivate _instructionFilesExist: boolean | undefined;\n`, "\n")
  .replace(`\t\t\t\tif (!additionalMessage && !this._lockedAgent) {
\t\t\t\t\tadditionalMessage = this._getGenerateInstructionsMessage();
\t\t\t\t}
`, "");
const generateInstructionsMessageMethod = `\tprivate _getGenerateInstructionsMessage(): IMarkdownString {
\t\t// Start checking for instruction files immediately if not already done
\t\tif (!this._instructionFilesCheckPromise) {
\t\t\tthis._instructionFilesCheckPromise = this._checkForAgentInstructionFiles();
\t\t\t// Use VS Code's idiomatic pattern for disposal-safe promise callbacks
\t\t\tthis._register(thenIfNotDisposed(this._instructionFilesCheckPromise, hasFiles => {
\t\t\t\tthis._instructionFilesExist = hasFiles;
\t\t\t\t// Only re-render if the current view still doesn't have items and we're showing the welcome message
\t\t\t\tconst hasViewModelItems = this.viewModel?.getItems().length ?? 0;
\t\t\t\tif (hasViewModelItems === 0) {
\t\t\t\t\tthis.renderWelcomeViewContentIfNeeded();
\t\t\t\t}
\t\t\t}));
\t\t}

\t\t// If we already know the result, use it
\t\tif (this._instructionFilesExist === true) {
\t\t\t// Don't show generate instructions message if files exist
\t\t\treturn new MarkdownString('');
\t\t} else if (this._instructionFilesExist === false) {
\t\t\t// Show generate instructions message if no files exist
\t\t\treturn new MarkdownString(localize(
\t\t\t\t'chatWidget.instructions',
\t\t\t\t"[Generate Agent Instructions]({0}) to onboard AI onto your codebase.",
\t\t\t\t\`command:\${GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID}\`
\t\t\t), { isTrusted: { enabledCommands: [GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID] } });
\t\t}

\t\t// While checking, don't show the generate instructions message
\t\treturn new MarkdownString('');
\t}

\t/**
\t * Checks if any agent instruction files (.github/skippr-instructions.md or AGENTS.md) exist in the workspace.
\t * Used to determine whether to show the "Generate Agent Instructions" hint.
\t *
\t * @returns true if instruction files exist OR if instruction features are disabled (to hide the hint)
\t */
\tprivate async _checkForAgentInstructionFiles(): Promise<boolean> {
\t\ttry {
\t\t\treturn (await this.promptsService.listAgentInstructions(CancellationToken.None)).length > 0;
\t\t} catch (error) {
\t\t\t// On error, assume no instruction files exist to be safe
\t\t\tthis.logService.warn('[ChatWidget] Error checking for instruction files:', error);
\t\t\treturn false;
\t\t}
\t}

`;
chatWidgetSource = chatWidgetSource.replace(generateInstructionsMessageMethod, "");
writeFileSync(chatWidgetPath, chatWidgetSource, "utf8");

const chatSetupRunnerPath = path.join(vscodeDir, "src", "vs", "workbench", "contrib", "chat", "browser", "chatSetup", "chatSetupRunner.ts");
let chatSetupRunnerSource = readFileSync(chatSetupRunnerPath, "utf8");
const socialProviderButtonsBlock = `\t\t\tconst defaultProviderButton: ContinueWithButton = [localize('continueWith', "Sign in to {0}", defaultChat.provider.default.name), ChatSetupStrategy.SetupWithoutEnterpriseProvider, styleButton('continue-button', 'default')];
\t\t\tconst defaultProviderLink: ContinueWithButton = [defaultProviderButton[0], defaultProviderButton[1], styleButton('link-button')];

\t\t\tconst enterpriseProviderButton: ContinueWithButton = [localize('continueWith', "Sign in to {0}", defaultChat.provider.enterprise.name), ChatSetupStrategy.SetupWithEnterpriseProvider, styleButton('continue-button', 'default')];
\t\t\tconst enterpriseProviderLink: ContinueWithButton = [enterpriseProviderButton[0], enterpriseProviderButton[1], styleButton('link-button')];

\t\t\tconst googleProviderButton: ContinueWithButton = [localize('continueWith', "Sign in to {0}", defaultChat.provider.google.name), ChatSetupStrategy.SetupWithGoogleProvider, styleButton('continue-button', 'google')];
\t\t\tconst appleProviderButton: ContinueWithButton = [localize('continueWith', "Sign in to {0}", defaultChat.provider.apple.name), ChatSetupStrategy.SetupWithAppleProvider, styleButton('continue-button', 'apple')];

\t\t\tif (!this.defaultAccountService.getDefaultAccountAuthenticationProvider().enterprise) {
\t\t\t\tbuttons = coalesce([
\t\t\t\t\tdefaultProviderButton,
\t\t\t\t\tgoogleProviderButton,
\t\t\t\t\tappleProviderButton,
\t\t\t\t\tenterpriseProviderLink
\t\t\t\t]);
\t\t\t} else {
\t\t\t\tbuttons = coalesce([
\t\t\t\t\tenterpriseProviderButton,
\t\t\t\t\tgoogleProviderButton,
\t\t\t\t\tappleProviderButton,
\t\t\t\t\tdefaultProviderLink
\t\t\t\t]);
\t\t\t}`;
const skipprProviderButtonBlock = `\t\t\tconst skipprProviderButton: ContinueWithButton = [localize('continueWithSkippr', "Sign in to Skippr"), ChatSetupStrategy.SetupWithoutEnterpriseProvider, styleButton('continue-button', 'skippr')];
\t\t\tbuttons = coalesce([skipprProviderButton]);`;
chatSetupRunnerSource = chatSetupRunnerSource.replace(socialProviderButtonsBlock, skipprProviderButtonBlock);
writeFileSync(chatSetupRunnerPath, chatSetupRunnerSource, "utf8");

const chatSetupCssPath = path.join(vscodeDir, "src", "vs", "workbench", "contrib", "chat", "browser", "chatSetup", "media", "chatSetup.css");
let chatSetupCssSource = readFileSync(chatSetupCssPath, "utf8");
chatSetupCssSource = chatSetupCssSource.replace(
  `\t.dialog-buttons-row > .dialog-buttons > .monaco-button.continue-button.default::before {
\t\tbackground-image: url('./github.svg');
\t}`,
  `\t.dialog-buttons-row > .dialog-buttons > .monaco-button.continue-button.skippr::before,
\t.dialog-buttons-row > .dialog-buttons > .monaco-button.continue-button.default::before {
\t\tcontent: 'S';
\t\tbackground: var(--vscode-button-foreground);
\t\tcolor: var(--vscode-button-background);
\t\tborder-radius: 4px;
\t\ttext-align: center;
\t\tfont-weight: 700;
\t\tfont-size: 11px;
\t\tline-height: 16px !important;
\t\theight: 16px;
\t\tmargin-right: 6px;
\t\tpadding-right: 0;
\t}`
)
  .replace(`\n\t.dialog-buttons-row > .dialog-buttons > .monaco-button.continue-button.google::before {
\t\tbackground-image: url('./google.svg');
\t}
`, "\n")
  .replace(`
.monaco-workbench.hc-light .chat-setup-dialog .dialog-buttons-row > .dialog-buttons > .monaco-button.continue-button.apple::before,
.monaco-workbench.vs .chat-setup-dialog .dialog-buttons-row > .dialog-buttons > .monaco-button.continue-button.apple::before {
\tbackground-image: url('./apple-light.svg');
}

.chat-setup-dialog .dialog-buttons-row > .dialog-buttons > .monaco-button.continue-button.apple::before {
\tbackground-image: url('./apple-dark.svg');
}
`, "\n");
writeFileSync(chatSetupCssPath, chatSetupCssSource, "utf8");

console.log("Skippr overlay applied successfully.");

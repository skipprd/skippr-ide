/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { BaseActionViewItem, IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { ISelectOptionItem, SelectBox } from '../../../../base/browser/ui/selectBox/selectBox.js';
import { IAction } from '../../../../base/common/actions.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Delayer } from '../../../../base/common/async.js';
import { EventType as TouchEventType, Gesture } from '../../../../base/browser/touch.js';
import * as nls from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { defaultSelectBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { selectBackground, selectBorder, asCssVariable } from '../../../../platform/theme/common/colorRegistry.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';
import { AccessibilityCommandId } from '../../accessibility/common/accessibilityCommands.js';
import { hasNativeContextMenu } from '../../../../platform/window/common/window.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { DEBUG_START_COMMAND_ID, DEBUG_START_LABEL } from './debugCommands.js';
import { debugStart } from './debugIcons.js';

const $ = dom.$;

const SKIPPR_TOOLBAR_REFRESH_DEBOUNCE_MS = 2000;

const SKIPPR_RUN_TOOLBAR_MODEL = 'skippr._runToolbarModel';
const SKIPPR_RUN_TOOLBAR_EXECUTE = 'skippr._runToolbarExecute';

const CMD_VALUES = ['discover', 'sync', 'sync-all', 'model', 'doctor', 'test'] as const;

const CMD_OPTIONS: ISelectOptionItem[] = [
	{ text: 'discover' },
	{ text: 'sync' },
	{ text: 'sync all' },
	{ text: 'model' },
	{ text: 'doctor' },
	{ text: 'test' },
];

/** Second column: maps to `skippr sync` —once vs streaming. */
const SYNC_MODE_OPTIONS: ISelectOptionItem[] = [
	{ text: nls.localize('skipprSyncOnce', 'Once') },
	{ text: nls.localize('skipprSyncStream', 'Stream') },
];

/** `skippr model --no-resume` */
const MODEL_THREAD_OPTIONS: ISelectOptionItem[] = [
	{ text: nls.localize('skipprModelResume', 'Resume thread') },
	{ text: nls.localize('skipprModelFresh', 'Fresh thread') },
];

/** Global `--log` (skippr CLI); first entry defers to workspace setting. */
const LOG_LEVEL_OPTIONS: ISelectOptionItem[] = [
	{ text: nls.localize('skipprLogDefault', 'Log (default)') },
	{ text: 'debug' },
	{ text: 'info' },
	{ text: 'warn' },
	{ text: 'error' },
];

const LOG_LEVEL_VALUES: Array<string | undefined> = [undefined, 'debug', 'info', 'warn', 'error'];

/** Shown only while the secondary column is hidden; avoids leaving the previous command’s labels in the SelectBox. */
const SECONDARY_PLACEHOLDER_OPTIONS: ISelectOptionItem[] = [{ text: '\u2014' }];

interface SkipprToolbarModel {
	configPath: string;
	defaultPipeline: string;
	pipelines: string[];
	tests?: Array<{ value: string; label: string }>;
}

type SecondaryColumnKind = 'none' | 'sync' | 'modelThread';

export class SkipprRunToolbarActionViewItem extends BaseActionViewItem {

	private container!: HTMLElement;
	private start!: HTMLElement;
	private readonly cmdBox: SelectBox;
	private readonly pipeBox: SelectBox;
	private readonly secondaryBox: SelectBox;
	private readonly testBox: SelectBox;
	private readonly logBox: SelectBox;
	private readonly refreshDelayer = this._register(new Delayer<void>(SKIPPR_TOOLBAR_REFRESH_DEBOUNCE_MS));
	private refreshChain: Promise<void> = Promise.resolve();
	private suppressPipeSelect = 0;
	private cmdIndex = 0;
	private pipeIndex = 0;
	private secondaryIndex = 0;
	private testIndex = 0;
	private logIndex = 0;
	private configPath = '';
	private pipeStrings: string[] = [];
	private testIds: string[] = [''];

	constructor(
		context: unknown,
		action: IAction,
		options: IBaseActionViewItemOptions,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextViewService contextViewService: IContextViewService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IHoverService private readonly hoverService: IHoverService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super(context, action, options);
		const selectOpts = { useCustomDrawn: !hasNativeContextMenu(this.configurationService) };
		this.cmdBox = this._register(new SelectBox(CMD_OPTIONS, 0, contextViewService, defaultSelectBoxStyles, { ariaLabel: nls.localize('skipprCommand', 'Skippr command'), ...selectOpts }));
		this.pipeBox = this._register(new SelectBox([], 0, contextViewService, defaultSelectBoxStyles, { ariaLabel: nls.localize('skipprPipeline', 'Pipeline'), ...selectOpts }));
		this.secondaryBox = this._register(new SelectBox(SYNC_MODE_OPTIONS, 0, contextViewService, defaultSelectBoxStyles, { ariaLabel: nls.localize('skipprSyncMode', 'Sync mode'), ...selectOpts }));
		this.testBox = this._register(new SelectBox([], 0, contextViewService, defaultSelectBoxStyles, { ariaLabel: nls.localize('skipprTest', 'dbt test'), ...selectOpts }));
		this.logBox = this._register(new SelectBox(LOG_LEVEL_OPTIONS, 0, contextViewService, defaultSelectBoxStyles, { ariaLabel: nls.localize('skipprLogLevel', 'Skippr log level'), ...selectOpts }));
		this._register(this.cmdBox.onDidSelect(e => {
			this.cmdIndex = e.index;
			this.onCommandDropdownChanged();
		}));
		this._register(this.pipeBox.onDidSelect(e => {
			this.pipeIndex = e.index;
			if (this.suppressPipeSelect > 0) {
				return;
			}
			this.onPipeOrCmdChanged();
		}));
		this._register(this.secondaryBox.onDidSelect(e => {
			this.secondaryIndex = e.index;
		}));
		this._register(this.testBox.onDidSelect(e => {
			this.testIndex = e.index;
		}));
		this._register(this.logBox.onDidSelect(e => {
			this.logIndex = e.index;
		}));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this.scheduleRefresh()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('skippr.run.cwd') || e.affectsConfiguration('skippr.workspacePath') || e.affectsConfiguration('skippr.defaultPipeline') || e.affectsConfiguration('skippr.cliPath') || e.affectsConfiguration('skippr.logLevel')) {
				this.scheduleRefresh();
			}
		}));
	}

	private secondaryKind(): SecondaryColumnKind {
		const c = this.getCommand();
		if (c === 'sync') {
			return 'sync';
		}
		if (c === 'model') {
			return 'modelThread';
		}
		return 'none';
	}

	/** Whenever the command dropdown changes: replace secondary/test options immediately, then refresh from the extension. */
	private onCommandDropdownChanged(): void {
		this.resetSecondaryForCommand();
		this.resetTestBoxWhenLeavingTest();
		this.updateExtrasVisibility(this.getCommand());
		this.onPipeOrCmdChanged();
		this.scheduleRefresh();
	}

	private resetSecondaryForCommand(): void {
		this.secondaryIndex = 0;
		const kind = this.secondaryKind();
		if (kind === 'sync') {
			this.secondaryBox.setOptions(SYNC_MODE_OPTIONS, 0);
			this.secondaryBox.setAriaLabel(nls.localize('skipprSyncMode', 'Sync mode'));
			this.secondaryBox.setEnabled(true);
		} else if (kind === 'modelThread') {
			this.secondaryBox.setOptions(MODEL_THREAD_OPTIONS, 0);
			this.secondaryBox.setAriaLabel(nls.localize('skipprModelThread', 'Model thread'));
			this.secondaryBox.setEnabled(true);
		} else {
			// discover, doctor, sync-all, test: no command-specific second column (CLI flags live elsewhere or use defaults).
			this.secondaryBox.setOptions(SECONDARY_PLACEHOLDER_OPTIONS, 0);
			this.secondaryBox.setAriaLabel(nls.localize('skipprSecondaryNone', 'No command options'));
			this.secondaryBox.setEnabled(false);
		}
	}

	private resetTestBoxWhenLeavingTest(): void {
		if (this.getCommand() === 'test') {
			return;
		}
		this.testIds = [''];
		this.testIndex = 0;
		this.testBox.setOptions(SECONDARY_PLACEHOLDER_OPTIONS, 0);
		this.testBox.setEnabled(false);
	}

	private onPipeOrCmdChanged(): void {
		if (this.getCommand() === 'test') {
			this.scheduleRefresh();
		}
	}

	private getCommand(): string {
		return CMD_VALUES[this.cmdIndex] ?? 'discover';
	}

	private getPipeline(): string {
		return this.pipeStrings[this.pipeIndex]?.trim() ?? '';
	}

	private getModelNoResume(): boolean {
		return this.secondaryKind() === 'modelThread' && this.secondaryIndex === 1;
	}

	private getExplicitLogLevel(): string | undefined {
		return LOG_LEVEL_VALUES[this.logIndex];
	}

	private scheduleRefresh(): void {
		if (this._store.isDisposed) {
			return;
		}
		void this.refreshDelayer.trigger(() => {
			this.refreshChain = this.refreshChain.then(() => this.refreshFromExtension());
		});
	}

	private setPipelineSelectOptions(items: ISelectOptionItem[], selected: number): void {
		if (this._store.isDisposed) {
			return;
		}
		this.pipeIndex = selected;
		this.suppressPipeSelect++;
		try {
			this.pipeBox.setOptions(items, selected);
		} finally {
			this.suppressPipeSelect--;
		}
	}

	private async refreshFromExtension(): Promise<void> {
		if (this._store.isDisposed) {
			return;
		}
		const command = this.getCommand();
		this.updateExtrasVisibility(command);
		const pipeline = this.needsPipeline(command) ? this.getPipeline() : '';
		try {
			const model = await this.commandService.executeCommand<SkipprToolbarModel>(SKIPPR_RUN_TOOLBAR_MODEL, { command, pipeline });
			if (this._store.isDisposed) {
				return;
			}
			if (!model || typeof model !== 'object') {
				return;
			}
			this.configPath = model.configPath?.trim() || '';
			const preferred = model.defaultPipeline?.trim() || '';
			const pls = Array.isArray(model.pipelines) ? model.pipelines : [];
			const previousPipeline = pipeline.trim();
			this.pipeStrings = pls.length ? pls.slice() : preferred ? [preferred] : [];
			const pipeItems: ISelectOptionItem[] = this.pipeStrings.length
				? this.pipeStrings.map(p => ({ text: p }))
				: [{ text: nls.localize('skipprNoPipeline', '(no pipeline)') }];
			let pick = 0;
			if (previousPipeline && this.pipeStrings.includes(previousPipeline)) {
				pick = this.pipeStrings.indexOf(previousPipeline);
			} else if (preferred && this.pipeStrings.includes(preferred)) {
				pick = this.pipeStrings.indexOf(preferred);
			} else if (this.pipeStrings.length) {
				pick = 0;
			}
			this.setPipelineSelectOptions(pipeItems, pick);

			const showPipe = this.needsPipeline(command);
			this.pipeBox.setEnabled(showPipe && Boolean(model.configPath));

			const sk = this.secondaryKind();
			const showSecondary = sk !== 'none' && Boolean(model.configPath);
			if (showSecondary && sk === 'sync') {
				const si = Math.min(this.secondaryIndex, SYNC_MODE_OPTIONS.length - 1);
				this.secondaryBox.setOptions(SYNC_MODE_OPTIONS, si);
				this.secondaryIndex = si;
				this.secondaryBox.setEnabled(true);
			} else if (showSecondary && sk === 'modelThread') {
				const mi = Math.min(this.secondaryIndex, MODEL_THREAD_OPTIONS.length - 1);
				this.secondaryBox.setOptions(MODEL_THREAD_OPTIONS, mi);
				this.secondaryIndex = mi;
				this.secondaryBox.setEnabled(true);
			} else if (!showSecondary && sk !== 'none') {
				// Keep the correct option set for this command while config is missing; disable until config exists.
				if (sk === 'sync') {
					const si = Math.min(this.secondaryIndex, SYNC_MODE_OPTIONS.length - 1);
					this.secondaryBox.setOptions(SYNC_MODE_OPTIONS, si);
					this.secondaryIndex = si;
				} else if (sk === 'modelThread') {
					const mi = Math.min(this.secondaryIndex, MODEL_THREAD_OPTIONS.length - 1);
					this.secondaryBox.setOptions(MODEL_THREAD_OPTIONS, mi);
					this.secondaryIndex = mi;
				}
				this.secondaryBox.setEnabled(false);
			} else {
				this.resetSecondaryForCommand();
			}

			const showTest = command === 'test';
			this.testBox.setEnabled(showTest && Boolean(model.configPath));
			if (showTest && model.tests?.length) {
				const tItems: ISelectOptionItem[] = [
					{ text: nls.localize('skipprAllTests', '(all tests)') },
					...model.tests.map(t => ({ text: t.label, decoratorRight: t.value })),
				];
				this.testIds = ['', ...model.tests.map(t => t.value)];
				this.testBox.setOptions(tItems, 0);
				this.testIndex = 0;
			} else if (showTest) {
				this.testIds = [''];
				this.testBox.setOptions([{ text: nls.localize('skipprAllTests', '(all tests)') }], 0);
				this.testIndex = 0;
			} else {
				this.testIds = [''];
				this.testIndex = 0;
				this.testBox.setOptions(SECONDARY_PLACEHOLDER_OPTIONS, 0);
				this.testBox.setEnabled(false);
			}

			const showLog = command !== 'doctor' && command !== 'sync-all' && command !== 'discover';
			this.logBox.setEnabled(Boolean(model.configPath) && showLog);
			this.logBox.setOptions(LOG_LEVEL_OPTIONS, Math.min(this.logIndex, LOG_LEVEL_OPTIONS.length - 1));

			this.updateExtrasVisibility(command);
		} catch {
			this.notificationService.warn(nls.localize('skipprToolbarModelFailed', 'Skippr toolbar could not refresh. Is the Skippr extension running?'));
		}
	}

	private needsPipeline(cmd: string): boolean {
		return cmd === 'discover' || cmd === 'sync' || cmd === 'model' || cmd === 'test';
	}

	private updateExtrasVisibility(command: string): void {
		const extras = this.container?.querySelector<HTMLElement>('.skippr-run-toolbar-extras');
		if (!extras) {
			return;
		}
		extras.style.display = command === 'doctor' || command === 'sync-all' ? 'none' : '';
		const pipeWrap = extras.querySelector<HTMLElement>('.skippr-toolbar-pipe');
		const secondaryWrap = extras.querySelector<HTMLElement>('.skippr-toolbar-secondary');
		const testWrap = extras.querySelector<HTMLElement>('.skippr-toolbar-test');
		const logWrap = extras.querySelector<HTMLElement>('.skippr-toolbar-log');
		if (pipeWrap) {
			pipeWrap.style.display = this.needsPipeline(command) ? '' : 'none';
		}
		if (secondaryWrap) {
			secondaryWrap.style.display = this.secondaryKind() !== 'none' ? '' : 'none';
		}
		if (testWrap) {
			testWrap.style.display = command === 'test' ? '' : 'none';
		}
		if (logWrap) {
			logWrap.style.display = command === 'doctor' || command === 'sync-all' || command === 'discover' ? 'none' : '';
		}
	}

	override render(container: HTMLElement): void {
		this.container = container;
		container.classList.add('skippr-start-action-item', 'start-debug-action-item');

		this.start = dom.append(container, $(ThemeIcon.asCSSSelector(debugStart)));
		const title = this.keybindingService.appendKeybinding(DEBUG_START_LABEL.value, DEBUG_START_COMMAND_ID);
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this.start, title));
		this.start.setAttribute('role', 'button');
		this.setStartAriaLabel(title);

		this._register(Gesture.addTarget(this.start));
		for (const event of [dom.EventType.CLICK, TouchEventType.Tap]) {
			this._register(dom.addDisposableListener(this.start, event, () => {
				this.start.blur();
				void this.runSkippr();
			}));
		}
		this._register(dom.addDisposableListener(this.start, dom.EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (this.action.enabled && e.button === 0) {
				this.start.classList.add('active');
			}
		}));
		this._register(dom.addDisposableListener(this.start, dom.EventType.MOUSE_UP, () => {
			this.start.classList.remove('active');
		}));
		this._register(dom.addDisposableListener(this.start, dom.EventType.MOUSE_OUT, () => {
			this.start.classList.remove('active');
		}));

		this._register(dom.addDisposableListener(this.start, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.RightArrow)) {
				this.start.tabIndex = -1;
				this.cmdBox.focus();
				event.stopPropagation();
			}
		}));

		const cmdWrap = dom.append(container, $('.configuration'));
		this.cmdBox.render(cmdWrap);
		this._register(dom.addDisposableListener(cmdWrap, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.LeftArrow)) {
				this.cmdBox.setFocusable(false);
				this.start.tabIndex = 0;
				this.start.focus();
				event.stopPropagation();
				event.preventDefault();
			}
		}));

		const extras = dom.append(container, $('.skippr-run-toolbar-extras'));
		const pipeWrap = dom.append(extras, $('.configuration.skippr-toolbar-pipe'));
		this.pipeBox.render(pipeWrap);
		const secondaryWrap = dom.append(extras, $('.configuration.skippr-toolbar-secondary'));
		this.secondaryBox.render(secondaryWrap);
		const testWrap = dom.append(extras, $('.configuration.skippr-toolbar-test'));
		this.testBox.render(testWrap);
		const logWrap = dom.append(extras, $('.configuration.skippr-toolbar-log'));
		this.logBox.render(logWrap);

		this._register(dom.addDisposableListener(pipeWrap, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.LeftArrow)) {
				this.pipeBox.setFocusable(false);
				this.cmdBox.focus();
				event.stopPropagation();
				event.preventDefault();
			}
		}));

		this.resetSecondaryForCommand();

		this.container.style.border = `1px solid ${asCssVariable(selectBorder)}`;
		cmdWrap.style.borderLeft = `1px solid ${asCssVariable(selectBorder)}`;
		pipeWrap.style.borderLeft = `1px solid ${asCssVariable(selectBorder)}`;
		secondaryWrap.style.borderLeft = `1px solid ${asCssVariable(selectBorder)}`;
		testWrap.style.borderLeft = `1px solid ${asCssVariable(selectBorder)}`;
		logWrap.style.borderLeft = `1px solid ${asCssVariable(selectBorder)}`;
		this.container.style.backgroundColor = asCssVariable(selectBackground);

		void this.refreshFromExtension();
	}

	private setStartAriaLabel(title: string): void {
		let ariaLabel = title;
		let keybinding: string | undefined;
		const verbose = this.configurationService.getValue(AccessibilityVerbositySettingId.Debug);
		if (verbose) {
			keybinding = this.keybindingService.lookupKeybinding(AccessibilityCommandId.OpenAccessibilityHelp, this.contextKeyService)?.getLabel() ?? undefined;
		}
		if (keybinding) {
			ariaLabel = nls.localize('skipprStartAriaWithA11y', '{0}, use ({1}) for accessibility help', ariaLabel, keybinding);
		} else {
			ariaLabel = nls.localize('skipprStartAriaNoA11yKb', '{0}, run the command Open Accessibility Help which is currently not triggerable via keybinding.', ariaLabel);
		}
		this.start.ariaLabel = ariaLabel;
	}

	private getTestSelectValue(): string {
		return this.testIds[this.testIndex] ?? '';
	}

	private async runSkippr(): Promise<void> {
		const command = this.getCommand();
		const pipeline = this.needsPipeline(command) ? this.getPipeline() : '';
		const syncMode = this.secondaryIndex === 1 ? 'stream' : 'once';
		const testSelect = command === 'test' ? this.getTestSelectValue() : '';
		const payload: Record<string, unknown> = {
			command,
			pipeline,
			testSelect,
		};
		if (this.configPath) {
			payload.configPath = this.configPath;
		}
		if (command === 'sync') {
			payload.syncMode = syncMode;
		}
		if (command === 'model') {
			payload.modelNoResume = this.getModelNoResume();
		}
		if (command !== 'discover') {
			const logLv = this.getExplicitLogLevel();
			if (logLv) {
				payload.logLevel = logLv;
			}
		}
		try {
			await this.commandService.executeCommand(SKIPPR_RUN_TOOLBAR_EXECUTE, payload);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.notificationService.error(nls.localize('skipprToolbarRunFailed', 'Skippr run failed: {0}', msg));
		}
	}

	override focus(fromRight?: boolean): void {
		if (fromRight) {
			this.cmdBox.focus();
		} else {
			this.start.tabIndex = 0;
			this.start.focus();
		}
	}

	override blur(): void {
		this.start.tabIndex = -1;
		this.cmdBox.blur();
		this.pipeBox.blur();
		this.secondaryBox.blur();
		this.testBox.blur();
		this.logBox.blur();
		this.container?.blur();
	}

	override setFocusable(focusable: boolean): void {
		if (focusable) {
			this.start.tabIndex = 0;
		} else {
			this.start.tabIndex = -1;
			this.cmdBox.setFocusable(false);
			this.pipeBox.setFocusable(false);
			this.secondaryBox.setFocusable(false);
			this.testBox.setFocusable(false);
			this.logBox.setFocusable(false);
		}
	}

	override dispose(): void {
		this.refreshDelayer.cancel();
		super.dispose();
	}
}

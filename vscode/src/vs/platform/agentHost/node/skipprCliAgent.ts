/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { observableValue } from '../../../base/common/observable.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogService } from '../../log/common/log.js';
import { IDiffComputeService } from '../common/diffComputeService.js';
import { AgentSession, type AgentProvider, type AgentSignal, type IAgent, type IAgentCreateSessionConfig, type IAgentCreateSessionResult, type IAgentDescriptor, type IAgentModelInfo, type IAgentResolveSessionConfigParams, type IAgentSessionConfigCompletionsParams, type IAgentSessionMetadata } from '../common/agentService.js';
import { ISessionDataService } from '../common/sessionDataService.js';
import type { ResolveSessionConfigResult, SessionConfigCompletionsResult } from '../common/state/protocol/commands.js';
import type { MessageAttachment, ModelSelection, ToolCallResult, ToolDefinition } from '../common/state/protocol/state.js';
import { ActionType, type SessionAction } from '../common/state/sessionActions.js';
import { FileEditKind, PolicyState, ResponsePartKind, SessionStatus, ToolCallConfirmationReason, ToolResultContentType, type CustomizationRef, type PendingMessage, type SessionInputAnswer, type SessionInputResponseKind, type ToolResultContent, type ToolResultFileEditContent, type Turn } from '../common/state/sessionState.js';
import { buildSessionDbUri } from './shared/fileEditTracker.js';

const SKIPPR_PROVIDER: AgentProvider = 'skippr';
const LOCAL_CARGO_CLI = '__skippr_local_cargo__';
const CHAT_COMMAND_TIMEOUT_MS = 10 * 60_000;
const moduleDirname = path.dirname(fileURLToPath(import.meta.url));

interface ISkipprSession {
	readonly session: URI;
	readonly createdAt: number;
	modifiedAt: number;
	readonly workspaceRoot: string | undefined;
	readonly configPath: string | undefined;
	readonly pipeline: string | undefined;
	readonly mode: SkipprChatMode;
	readonly workingDirectory: URI | undefined;
	readonly project: { uri: URI; displayName: string } | undefined;
	child?: cp.ChildProcessWithoutNullStreams;
	threadId?: string;
}

interface ISkipprToolCall {
	readonly id: string;
	readonly name: string;
	readonly displayName: string;
	started: boolean;
	ready: boolean;
}

type SkipprChatMode = 'ask' | 'plan' | 'agent';

export class SkipprCliAgent extends Disposable implements IAgent {
	readonly id = SKIPPR_PROVIDER;

	private readonly _onDidSessionProgress = this._register(new Emitter<AgentSignal>());
	readonly onDidSessionProgress = this._onDidSessionProgress.event;

	private readonly _models = observableValue<readonly IAgentModelInfo[]>(this, [
		{
			provider: SKIPPR_PROVIDER,
			id: 'skippr-cli',
			name: 'Skippr CLI',
			supportsVision: false,
			policyState: PolicyState.Enabled,
		},
	]);
	readonly models = this._models;

	private readonly _sessions = new Map<string, ISkipprSession>();
	private readonly _toolCallsBySession = new Map<string, Map<string, ISkipprToolCall>>();

	constructor(
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
		@ILogService private readonly _logService: ILogService,
		@IDiffComputeService private readonly _diffComputeService: IDiffComputeService,
	) {
		super();
	}

	getDescriptor(): IAgentDescriptor {
		return {
			provider: SKIPPR_PROVIDER,
			displayName: 'Skippr Agent',
			description: 'Runs Skippr CLI chat inside the agent-host pipeline.',
		};
	}

	getProtectedResources(): [] {
		return [];
	}

	async createSession(config?: IAgentCreateSessionConfig): Promise<IAgentCreateSessionResult> {
		const workspaceRoot = workspaceRootFromWorkingDirectory(config?.workingDirectory);
		const configPath = findWorkspaceConfigPath(workspaceRoot);
		const pipeline = stringConfig(config?.config, 'pipeline');
		const mode = chatModeConfig(config?.config);
		const workingDirectory = workspaceRoot ? URI.file(workspaceRoot) : config?.workingDirectory;
		const session = config?.session ?? AgentSession.uri(this.id, generateUuid());
		const project = workingDirectory ? { uri: workingDirectory, displayName: path.basename(workingDirectory.fsPath) || 'Skippr' } : undefined;

		this._sessions.set(session.toString(), {
			session,
			createdAt: Date.now(),
			modifiedAt: Date.now(),
			workspaceRoot,
			configPath,
			pipeline,
			mode,
			workingDirectory,
			project,
		});

		return { session, workingDirectory, project };
	}

	async resolveSessionConfig(params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult> {
		const workspaceRoot = workspaceRootFromWorkingDirectory(params.workingDirectory);
		const configPath = findWorkspaceConfigPath(workspaceRoot) ?? '';
		return {
			schema: {
				type: 'object',
				properties: {
					mode: {
						type: 'string',
						title: 'Mode',
						description: 'Skippr chat mode',
						enum: ['ask', 'plan', 'agent'],
						default: 'agent',
					},
				},
			},
			values: {
				...(params.config ?? {}),
				...(configPath ? { configPath } : {}),
				mode: chatModeConfig(params.config),
			},
		};
	}

	async sessionConfigCompletions(_params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		return { items: [] };
	}

	async sendMessage(session: URI, prompt: string, _attachments?: readonly MessageAttachment[], turnId?: string): Promise<void> {
		const state = this._sessions.get(session.toString());
		if (!state) {
			throw new Error(`Unknown Skippr session: ${session.toString()}`);
		}
		if (!turnId) {
			throw new Error('Skippr agent-host turns require a turnId');
		}
		if (!state.workspaceRoot) {
			this._emitAction(session, {
				type: ActionType.SessionError,
				session: session.toString(),
				turnId,
				error: {
					errorType: 'missingWorkspaceRoot',
					message: 'Skippr Agent requires an open workspace folder to run chat.',
				},
			});
			return;
		}

		state.modifiedAt = Date.now();
		const cliPath = resolveSkipprCli();
		const args = [
			...(state.configPath && state.pipeline ? ['--config', state.configPath] : []),
			'chat',
			'send',
			...(state.pipeline ? ['--pipeline', state.pipeline] : []),
			'--mode',
			state.mode,
			'--message',
			buildIdeChatMessage(prompt, state),
			...(state.threadId ? ['--thread', state.threadId] : []),
			'--output',
			'jsonl',
		];
		const [command, ...commandArgs] = buildCliCommand(cliPath, args);
		const cwd = cliCommandCwd(cliPath) ?? state.workspaceRoot;
		this._logService.info(`[SkipprCliAgent] $ ${[command, ...commandArgs].join(' ')}`);

		await this._runCli(state, turnId, command, commandArgs, cwd);
	}

	async getSessionMessages(_session: URI): Promise<readonly Turn[]> {
		return [];
	}

	async disposeSession(session: URI): Promise<void> {
		await this.abortSession(session);
		this._sessions.delete(session.toString());
		this._toolCallsBySession.delete(session.toString());
	}

	async abortSession(session: URI): Promise<void> {
		const state = this._sessions.get(session.toString());
		state?.child?.kill('SIGTERM');
		if (state) {
			state.child = undefined;
		}
	}

	async changeModel(_session: URI, _model: ModelSelection): Promise<void> {
		// Skippr CLI owns model selection for now.
	}

	respondToPermissionRequest(_requestId: string, _approved: boolean): void {
		// Skippr CLI handles approval prompts in its own protocol.
	}

	respondToUserInputRequest(_requestId: string, _response: SessionInputResponseKind, _answers?: Record<string, SessionInputAnswer>): void {
		// Skippr CLI handles approval prompts in its own protocol.
	}

	async listSessions(): Promise<IAgentSessionMetadata[]> {
		return [...this._sessions.values()].map(session => ({
			session: session.session,
			startTime: session.createdAt,
			modifiedTime: session.modifiedAt,
			project: session.project,
			workingDirectory: session.workingDirectory,
			summary: session.pipeline ? `Skippr ${session.pipeline}` : 'Skippr Agent',
			status: session.child ? SessionStatus.InProgress : SessionStatus.Idle,
		}));
	}

	async getSessionMetadata(session: URI): Promise<IAgentSessionMetadata | undefined> {
		return (await this.listSessions()).find(item => item.session.toString() === session.toString());
	}

	authenticate(_resource: string, _token: string): Promise<boolean> {
		return Promise.resolve(true);
	}

	setPendingMessages(_session: URI, _steeringMessage: PendingMessage | undefined, _queuedMessages: readonly PendingMessage[]): void {
		// Skippr CLI does not support mid-turn steering through this provider yet.
	}

	getCustomizations(): readonly CustomizationRef[] {
		return [];
	}

	setClientCustomizations(): Promise<[]> {
		return Promise.resolve([]);
	}

	setClientTools(_session: URI, _clientId: string, _tools: ToolDefinition[]): void {
		// Client tools are not exposed to Skippr CLI yet.
	}

	onClientToolCallComplete(_session: URI, _toolCallId: string, _result: ToolCallResult): void {
		// Client tools are not exposed to Skippr CLI yet.
	}

	setCustomizationEnabled(_uri: string, _enabled: boolean): void {
		// Skippr CLI customizations are resolved by the CLI.
	}

	async shutdown(): Promise<void> {
		for (const session of this._sessions.values()) {
			session.child?.kill('SIGTERM');
		}
	}

	override dispose(): void {
		for (const session of this._sessions.values()) {
			session.child?.kill('SIGTERM');
		}
		super.dispose();
	}

	private async _runCli(state: ISkipprSession, turnId: string, command: string, commandArgs: string[], cwd: string): Promise<void> {
		const child = cp.spawn(command, commandArgs, { cwd, env: process.env, shell: false });
		state.child = child;

		let stdoutBuffer = '';
		let stderr = '';
		const tools = this._toolsForSession(state.session);
		const cleanup = this._register(toDisposable(() => child.kill('SIGTERM')));
		try {
			await new Promise<void>((resolve, reject) => {
				const timeoutHandle = setTimeout(() => {
					child.kill('SIGTERM');
					reject(new Error(`Skippr chat timed out after ${Math.round(CHAT_COMMAND_TIMEOUT_MS / 1000)}s without a final response.`));
				}, CHAT_COMMAND_TIMEOUT_MS);

				child.stdout.setEncoding('utf8');
				child.stdout.on('data', (chunk: string) => {
					stdoutBuffer += chunk;
					let nl = stdoutBuffer.indexOf('\n');
					while (nl >= 0) {
						const line = stdoutBuffer.slice(0, nl).trim();
						stdoutBuffer = stdoutBuffer.slice(nl + 1);
						nl = stdoutBuffer.indexOf('\n');
						if (line) {
							this._handleJsonlLine(state, turnId, tools, line).catch(err => this._logService.error('[SkipprCliAgent] JSONL mapping failed', err));
						}
					}
				});
				child.stderr.setEncoding('utf8');
				child.stderr.on('data', (chunk: string) => {
					stderr += chunk;
					this._logService.info(chunk.trimEnd());
				});
				child.on('error', error => {
					clearTimeout(timeoutHandle);
					reject(error);
				});
				child.on('close', (code, signal) => {
					clearTimeout(timeoutHandle);
					const tail = stdoutBuffer.trim();
					if (tail) {
						this._handleJsonlLine(state, turnId, tools, tail).catch(err => this._logService.error('[SkipprCliAgent] JSONL tail mapping failed', err));
					}
					if (code === 0 && !signal) {
						resolve();
					} else {
						reject(new Error(stderr.trim() || `Skippr CLI exited with code ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}`));
					}
				});
			});
			this._emitAction(state.session, { type: ActionType.SessionTurnComplete, session: state.session.toString(), turnId });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._emitAction(state.session, {
				type: ActionType.SessionError,
				session: state.session.toString(),
				turnId,
				error: { errorType: 'skipprCliFailed', message },
			});
		} finally {
			cleanup.dispose();
			if (state.child === child) {
				state.child = undefined;
			}
		}
	}

	private async _handleJsonlLine(state: ISkipprSession, turnId: string, tools: Map<string, ISkipprToolCall>, line: string): Promise<void> {
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			this._logService.warn(`[SkipprCliAgent] non-JSON stdout line: ${line}`);
			return;
		}
		if (!event || typeof event !== 'object') {
			return;
		}
		const o = event as Record<string, unknown>;
		const type = stringField(o, 'type');

		if (type === 'tool_start') {
			this._emitToolStart(state.session, turnId, tools, o);
			return;
		}
		if (type === 'tool_end') {
			await this._emitToolEnd(state.session, turnId, tools, o);
			return;
		}
		if (type === 'final') {
			const markdown = stringFieldFromObject(o.result, ['markdown', 'display', 'answer', 'text']);
			if (markdown) {
				this._emitMarkdown(state.session, turnId, markdown);
			}
			return;
		}
		if (type === 'ChatSummary') {
			const threadId = stringFieldFromObject(o, ['thread_id', 'threadId']);
			if (threadId) {
				state.threadId = threadId;
			}
			if (o.ok === false) {
				const failure = stringField(o, 'failure_summary') ?? stringField(o, 'bootstrap_error') ?? 'Skippr chat failed.';
				this._emitAction(state.session, {
					type: ActionType.SessionError,
					session: state.session.toString(),
					turnId,
					error: { errorType: 'skipprChatFailed', message: failure },
				});
			}
			return;
		}
		if (type === 'phase') {
			const phase = stringField(o, 'phase');
			if (phase) {
				this._emitMarkdown(state.session, turnId, `Phase running: ${phase}`);
			}
			return;
		}
		if (type === 'llm_start' || type === 'llm_end') {
			return;
		}
		const assistant = assistantSnippetFromChatJsonlObject(o);
		if (assistant) {
			this._emitMarkdown(state.session, turnId, assistant);
		}
	}

	private _emitToolStart(session: URI, turnId: string, tools: Map<string, ISkipprToolCall>, event: Record<string, unknown>): void {
		const tool = this._toolFromEvent(tools, event);
		if (!tool.started) {
			tool.started = true;
			this._emitAction(session, {
				type: ActionType.SessionToolCallStart,
				session: session.toString(),
				turnId,
				toolCallId: tool.id,
				toolName: tool.name,
				displayName: tool.displayName,
			});
		}
		if (!tool.ready) {
			tool.ready = true;
			this._emitAction(session, {
				type: ActionType.SessionToolCallReady,
				session: session.toString(),
				turnId,
				toolCallId: tool.id,
				invocationMessage: `Running ${tool.displayName}`,
				confirmed: ToolCallConfirmationReason.NotNeeded,
			});
		}
	}

	private async _emitToolEnd(session: URI, turnId: string, tools: Map<string, ISkipprToolCall>, event: Record<string, unknown>): Promise<void> {
		this._emitToolStart(session, turnId, tools, event);
		const tool = this._toolFromEvent(tools, event);
		const status = stringField(event, 'status')?.toLowerCase();
		const success = status !== 'failed';
		const content: ToolResultContent[] = [];
		const fileEdit = success ? await this._fileEditFromLocalIdePatch(session, turnId, tool.id, event) : undefined;
		if (fileEdit) {
			content.push(fileEdit);
		} else {
			content.push({ type: ToolResultContentType.Text, text: this._toolResultText(event) });
		}
		this._emitAction(session, {
			type: ActionType.SessionToolCallComplete,
			session: session.toString(),
			turnId,
			toolCallId: tool.id,
			result: {
				success,
				pastTenseMessage: toolPastTenseMessage(event, success, fileEdit),
				content,
				structuredContent: objectField(event, 'payload') ?? objectField(event, 'observation'),
				...(success ? {} : { error: { message: stringField(event, 'error') ?? `${tool.displayName} failed` } }),
			},
		});
	}

	private async _fileEditFromLocalIdePatch(session: URI, turnId: string, toolCallId: string, event: Record<string, unknown>): Promise<ToolResultFileEditContent | undefined> {
		if (stringField(event, 'name') !== 'local_ide') {
			return undefined;
		}
		const observation = objectField(event, 'payload') ?? objectField(event, 'observation');
		if (!observation || observation.no_op === true) {
			return undefined;
		}
		const filePath = stringField(observation, 'absolute_path');
		const beforeContent = typeof observation.before_content === 'string' ? observation.before_content : undefined;
		const afterContent = typeof observation.after_content === 'string' ? observation.after_content : undefined;
		if (!filePath || beforeContent === undefined || afterContent === undefined) {
			return undefined;
		}

		const counts = await this._diffCounts(beforeContent, afterContent);
		const ref = this._sessionDataService.openDatabase(session);
		try {
			await ref.object.storeFileEdit({
				turnId,
				toolCallId,
				filePath,
				kind: beforeContent.length === 0 && afterContent.length > 0 ? FileEditKind.Create : FileEditKind.Edit,
				beforeContent: VSBuffer.fromString(beforeContent).buffer,
				afterContent: VSBuffer.fromString(afterContent).buffer,
				addedLines: counts.added,
				removedLines: counts.removed,
			});
		} finally {
			ref.dispose();
		}

		const fileUri = URI.file(filePath).toString();
		return {
			type: ToolResultContentType.FileEdit,
			before: {
				uri: fileUri,
				content: { uri: buildSessionDbUri(session.toString(), toolCallId, filePath, 'before') },
			},
			after: {
				uri: fileUri,
				content: { uri: buildSessionDbUri(session.toString(), toolCallId, filePath, 'after') },
			},
			diff: counts,
		};
	}

	private _toolFromEvent(tools: Map<string, ISkipprToolCall>, event: Record<string, unknown>): ISkipprToolCall {
		const id = scalarStringField(event, 'tool_id') ?? scalarStringField(event, 'toolId') ?? generateUuid();
		let tool = tools.get(id);
		if (!tool) {
			const name = stringField(event, 'name') ?? 'tool';
			tool = {
				id,
				name,
				displayName: toolDisplayName(event, name),
				started: false,
				ready: false,
			};
			tools.set(id, tool);
		}
		return tool;
	}

	private _toolsForSession(session: URI): Map<string, ISkipprToolCall> {
		const key = session.toString();
		let tools = this._toolCallsBySession.get(key);
		if (!tools) {
			tools = new Map();
			this._toolCallsBySession.set(key, tools);
		}
		return tools;
	}

	private _emitMarkdown(session: URI, turnId: string, content: string): void {
		this._emitAction(session, {
			type: ActionType.SessionResponsePart,
			session: session.toString(),
			turnId,
			part: {
				kind: ResponsePartKind.Markdown,
				id: generateUuid(),
				content,
			},
		});
	}

	private _emitAction(session: URI, action: SessionAction): void {
		this._onDidSessionProgress.fire({ kind: 'action', session, action });
	}

	private _toolResultText(event: Record<string, unknown>): string {
		if (stringField(event, 'name') === 'local_ide') {
			return localIdePastTenseMessage(event, false);
		}
		const payload = objectField(event, 'payload') ?? objectField(event, 'observation');
		if (payload) {
			return JSON.stringify(payload, null, 2);
		}
		return stringField(event, 'error') ?? stringField(event, 'clean_name') ?? stringField(event, 'name') ?? 'Tool complete';
	}

	private async _diffCounts(before: string, after: string): Promise<{ added: number; removed: number }> {
		try {
			return await this._diffComputeService.computeDiffCounts(before, after);
		} catch (err) {
			this._logService.warn('[SkipprCliAgent] Failed to compute file edit diff counts', err);
			return estimateLineDelta(before, after);
		}
	}
}

function resolveSkipprCli(): string {
	const configured = process.env.SKIPPR_CLI_PATH?.trim();
	if (configured) {
		return configured;
	}
	return resolveLocalSkipprdManifest() ? LOCAL_CARGO_CLI : 'skippr';
}

function buildCliCommand(cliPath: string, args: string[]): string[] {
	if (cliPath !== LOCAL_CARGO_CLI) {
		return [cliPath, ...args];
	}
	const manifestPath = resolveLocalSkipprdManifest();
	if (!manifestPath) {
		return ['skippr', ...args];
	}
	return ['cargo', 'run', '--manifest-path', manifestPath, '-p', 'skippr-cli', '--', ...args];
}

function cliCommandCwd(cliPath: string): string | undefined {
	const manifestPath = cliPath === LOCAL_CARGO_CLI ? resolveLocalSkipprdManifest() : undefined;
	return manifestPath ? path.dirname(manifestPath) : undefined;
}

function resolveLocalSkipprdManifest(): string | undefined {
	const candidates = [
		process.env.SKIPPRD_MANIFEST_PATH,
		path.resolve(process.cwd(), '../skipprd/Cargo.toml'),
		path.resolve(process.cwd(), '../../skipprd/Cargo.toml'),
		path.resolve(process.cwd(), '../../../skipprd/Cargo.toml'),
		path.resolve(moduleDirname, '../../../../../skipprd/Cargo.toml'),
		path.resolve(moduleDirname, '../../../../../../skipprd/Cargo.toml'),
	].filter((candidate): candidate is string => Boolean(candidate?.trim()));
	return candidates.find(candidate => fs.existsSync(candidate));
}

function workspaceRootFromWorkingDirectory(workingDirectory: URI | undefined): string | undefined {
	return workingDirectory?.scheme === 'file' && workingDirectory.fsPath.trim() ? workingDirectory.fsPath : undefined;
}

function findWorkspaceConfigPath(workspaceRoot: string | undefined): string | undefined {
	if (!workspaceRoot) {
		return undefined;
	}
	for (const name of ['skippr.yml', 'skippr.yaml']) {
		const candidate = path.join(workspaceRoot, name);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function buildIdeChatMessage(prompt: string, state: ISkipprSession): string {
	return JSON.stringify({
		user: prompt,
		execution_surface: 'ide_chat',
		context: {
			workspace_root: state.workspaceRoot,
			config_path: state.configPath,
		},
	});
}

function stringConfig(config: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = config?.[key];
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function chatModeConfig(config: Record<string, unknown> | undefined): SkipprChatMode {
	const value = stringConfig(config, 'mode');
	return value === 'ask' || value === 'plan' || value === 'agent' ? value : 'agent';
}

function stringField(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const field = (value as Record<string, unknown>)[key];
	return typeof field === 'string' && field.trim() ? field.trim() : undefined;
}

function scalarStringField(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const field = (value as Record<string, unknown>)[key];
	if (typeof field === 'string') {
		return field.trim() || undefined;
	}
	if (typeof field === 'number' || typeof field === 'boolean') {
		return String(field);
	}
	return undefined;
}

function objectField(value: unknown, key: string): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const field = (value as Record<string, unknown>)[key];
	return field && typeof field === 'object' && !Array.isArray(field) ? field as Record<string, unknown> : undefined;
}

function stringFieldFromObject(value: unknown, keys: readonly string[]): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	for (const key of keys) {
		const direct = stringField(value, key);
		if (direct) {
			return direct;
		}
	}
	for (const child of Object.values(value as Record<string, unknown>)) {
		const nested = stringFieldFromObject(child, keys);
		if (nested) {
			return nested;
		}
	}
	return undefined;
}

function assistantSnippetFromChatJsonlObject(line: unknown): string | undefined {
	if (!line || typeof line !== 'object') {
		return undefined;
	}
	const o = line as Record<string, unknown>;
	if (o.type === 'assistant' || o.type === 'answer' || o.type === 'message') {
		return stringFieldFromObject(o, ['markdown', 'display', 'answer', 'text']);
	}
	return undefined;
}

function displayToolName(name: string): string {
	return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

function toolDisplayName(event: Record<string, unknown>, name: string): string {
	if (name === 'local_ide') {
		return 'Inspect files';
	}
	const cleanName = stringField(event, 'clean_name');
	return cleanName && cleanName !== 'Local Ide' ? cleanName : displayToolName(name);
}

function toolPastTenseMessage(event: Record<string, unknown>, success: boolean, fileEdit: ToolResultFileEditContent | undefined): string {
	const name = stringField(event, 'name') ?? 'tool';
	if (name === 'local_ide') {
		return localIdePastTenseMessage(event, !!fileEdit, success);
	}
	const displayName = toolDisplayName(event, name);
	return success ? `Ran ${displayName}` : `Failed ${displayName}`;
}

function localIdePastTenseMessage(event: Record<string, unknown>, isFileEdit: boolean, success = true): string {
	const observation = objectField(event, 'payload') ?? objectField(event, 'observation');
	const label = observation ? fileLabelFromObservation(observation) : undefined;
	if (!success) {
		return label ? `Failed to inspect ${label}` : 'Failed to inspect files';
	}
	if (isFileEdit || stringField(observation, 'absolute_path')) {
		return label ? `Edited ${label}` : 'Edited file';
	}
	if (Array.isArray(observation?.matches)) {
		return label ? `Searched ${label}` : 'Searched files';
	}
	if (Array.isArray(observation?.entries)) {
		return label ? `Listed ${label}` : 'Listed files';
	}
	const op = stringField(observation, 'op');
	if (op === 'head') {
		return label ? `Read start of ${label}` : 'Read file start';
	}
	if (op === 'tail') {
		return label ? `Read end of ${label}` : 'Read file end';
	}
	if (typeof observation?.content === 'string') {
		return label ? `Read ${label}` : 'Read file';
	}
	return label ? `Inspected ${label}` : 'Inspected files';
}

function fileLabelFromObservation(observation: Record<string, unknown>): string | undefined {
	const rawPath = stringField(observation, 'path') ?? stringField(observation, 'absolute_path');
	if (!rawPath) {
		return undefined;
	}
	return path.basename(rawPath) || rawPath;
}

function estimateLineDelta(before: string, after: string): { added: number; removed: number } {
	const beforeLines = before.length ? before.split(/\r?\n/).length : 0;
	const afterLines = after.length ? after.split(/\r?\n/).length : 0;
	return {
		added: Math.max(afterLines - beforeLines, 0),
		removed: Math.max(beforeLines - afterLines, 0),
	};
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
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
import {
	buildSkipprCliInvocation,
	enrichCargoFailureDetail,
	resolveSkipprCliForIde,
} from './skipprLocalCargo.js';

const SKIPPR_PROVIDER: AgentProvider = 'skippr';
const CHAT_COMMAND_TIMEOUT_MS = 10 * 60_000;
const MODEL_COMMAND_TIMEOUT_MS = 60 * 60_000;
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
	modelBridgeInFlight?: boolean;
}

interface ISkipprToolCall {
	readonly id: string;
	readonly name: string;
	readonly displayName: string;
	started: boolean;
	ready: boolean;
}

type SkipprChatMode = 'ask' | 'plan' | 'agent';

type ModelSlashRequest = {
	readonly pipeline: string | undefined;
	readonly noResume: boolean;
};

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
		const configPath = stringConfig(config?.config, 'configPath') ?? findWorkspaceConfigPath(workspaceRoot);
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
		const pipelines = listPipelinesFromConfig(configPath);
		const pipeline = stringConfig(params.config, 'pipeline');
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
					pipeline: {
						type: 'string',
						title: 'Pipeline',
						description: 'Skippr pipeline',
						...(pipelines.length ? { enum: pipelines } : {}),
					},
				},
			},
			values: {
				...(params.config ?? {}),
				...(configPath ? { configPath } : {}),
				...(pipeline ? { pipeline } : {}),
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
		const modelSlash = parseModelSlashPrompt(prompt, state);
		if (modelSlash) {
			await this._runModelSubagent(state, turnId, modelSlash);
			return;
		}

		const cliPath = resolveSkipprCli();
		const pipeline = state.pipeline;
		const effectiveState = pipeline ? { ...state, pipeline } : state;
		const args = [
			...(state.configPath ? ['--config', state.configPath] : []),
			'chat',
			'send',
			...(pipeline ? ['--pipeline', pipeline] : []),
			'--mode',
			state.mode,
			'--message',
			buildIdeChatMessage(prompt, effectiveState),
			...(state.threadId ? ['--thread', state.threadId] : []),
			'--output',
			'jsonl',
		];
		const extraManifestCandidates = state.workspaceRoot
			? [path.join(path.dirname(state.workspaceRoot), 'skipprd/Cargo.toml')]
			: [];
		const extraReactSearchPaths = state.workspaceRoot
			? [path.join(path.dirname(state.workspaceRoot), 'react')]
			: [];
		const { command, argv: commandArgs, cwd: cargoCwd } = buildSkipprCliInvocation(cliPath, args, {
			extraManifestCandidates,
			extraReactSearchPaths,
		});
		const cwd = cargoCwd ?? state.workspaceRoot;
		this._logService.info(`[SkipprCliAgent] $ ${[command, ...commandArgs].join(' ')}`);

		if (effectiveState.mode === 'ask') {
			this._writeAskQueryRunningBridgeMessage(effectiveState, prompt);
		}
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
			status: session.child || session.modelBridgeInFlight ? SessionStatus.InProgress : SessionStatus.Idle,
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
		const child = cp.spawn(command, commandArgs, {
			cwd,
			env: { ...process.env, SKIPPR_EXECUTION_SURFACE: 'ide_chat' },
			shell: false,
		});
		state.child = child;

		let stdoutBuffer = '';
		let stderr = '';
		const tools = this._toolsForSession(state.session);
		const pendingLineHandlers = new Set<Promise<void>>();
		const handleLine = (line: string, source: string) => {
			const handled = this._handleJsonlLine(state, turnId, tools, line)
				.catch(err => this._logService.error(`[SkipprCliAgent] ${source} JSONL mapping failed`, err))
				.finally(() => pendingLineHandlers.delete(handled));
			pendingLineHandlers.add(handled);
		};
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
							handleLine(line, 'chat');
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
						handleLine(tail, 'chat tail');
					}
					void Promise.allSettled([...pendingLineHandlers]).then(() => {
						if (code === 0 && !signal) {
							resolve();
						} else {
							reject(new Error(stderr.trim() || `Skippr CLI exited with code ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}`));
						}
					});
				});
			});
			this._emitAction(state.session, { type: ActionType.SessionTurnComplete, session: state.session.toString(), turnId });
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			const message = enrichCargoFailureDetail(raw, stderr) ?? raw;
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

	private async _runModelSubagent(
		state: ISkipprSession,
		turnId: string,
		request: ModelSlashRequest,
		toolIdOverride?: string,
		completeTurn = true,
	): Promise<void> {
		const session = state.session;
		const tools = this._toolsForSession(session);
		const pipeline = request.pipeline;
		if (!pipeline) {
			this._emitAction(session, {
				type: ActionType.SessionError,
				session: session.toString(),
				turnId,
				error: { errorType: 'missingPipeline', message: 'Skippr /model requires a selected pipeline.' },
			});
			return;
		}
		if (!state.configPath) {
			this._emitAction(session, {
				type: ActionType.SessionError,
				session: session.toString(),
				turnId,
				error: { errorType: 'missingConfig', message: 'Skippr /model requires a resolved skippr.yml config path.' },
			});
			return;
		}
		const dbtOutputPath = modelDbtOutputPath(state, pipeline);
		const toolId = toolIdOverride ?? `model_subagent:${turnId}`;
		this._emitToolStart(session, turnId, tools, {
			tool_id: toolId,
			name: 'model_subagent',
			clean_name: 'Model subagent',
			payload: { pipeline, dbt_output_path: dbtOutputPath, no_resume: request.noResume },
		});
		this._emitProgressMarkdown(session, turnId, `Running model workflow for \`${pipeline}\`.`);
		const events: Record<string, unknown>[] = [];
		const fileEdits: ToolResultFileEditContent[] = [];
		state.modelBridgeInFlight = true;
		try {
			const complete = await this._runModelThroughWorkbenchBridge(state, turnId, pipeline, request.noResume, toolId, events, fileEdits);
			const ok = complete['ok'] !== false;
			const error = ok ? undefined : stringField(complete, 'errorDetail') ?? stringField(complete, 'error') ?? 'Skippr model failed.';
			const payload = modelSubagentSummary(events, pipeline, dbtOutputPath);
			await this._emitModelSubagentComplete(session, turnId, tools, toolId, ok, payload, fileEdits, error);
			if (ok && completeTurn) {
				this._emitAction(session, { type: ActionType.SessionTurnComplete, session: session.toString(), turnId });
			} else if (!ok) {
				this._emitAction(session, {
					type: ActionType.SessionError,
					session: session.toString(),
					turnId,
					error: { errorType: 'skipprModelFailed', message: error ?? 'Skippr model failed.' },
				});
			}
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			const message = enrichCargoFailureDetail(raw, undefined) ?? raw;
			await this._emitModelSubagentComplete(
				session,
				turnId,
				tools,
				toolId,
				false,
				modelSubagentSummary(events, pipeline, dbtOutputPath, message),
				fileEdits,
				message,
			);
			this._emitAction(session, {
				type: ActionType.SessionError,
				session: session.toString(),
				turnId,
				error: { errorType: 'skipprModelFailed', message },
			});
		} finally {
			state.modelBridgeInFlight = false;
		}
	}

	private async _runModelThroughWorkbenchBridge(
		state: ISkipprSession,
		turnId: string,
		pipeline: string,
		noResume: boolean,
		toolCallId: string,
		events: Record<string, unknown>[],
		fileEdits: ToolResultFileEditContent[],
	): Promise<Record<string, unknown>> {
		if (!state.workspaceRoot || !state.configPath) {
			throw new Error('Skippr model bridge requires workspace root and config path.');
		}
		const bridgeDir = agentBridgeDirForWorkspace(state.workspaceRoot);
		fs.mkdirSync(bridgeDir, { recursive: true });
		const requestId = `model-${generateUuid()}`;
		const requestPath = path.join(bridgeDir, `${requestId}.request.json`);
		const responsePath = path.join(bridgeDir, `${requestId}.response.jsonl`);
		fs.rmSync(responsePath, { force: true });
		fs.writeFileSync(requestPath, JSON.stringify({
			id: requestId,
			kind: 'model',
			pipeline,
			configPath: state.configPath,
			noResume,
			workspaceRoot: state.workspaceRoot,
			sourceChatSessionId: state.session.toString(),
			sourceTurnId: turnId,
			createdAt: new Date().toISOString(),
		}, null, 2), 'utf8');

		let processedLines = 0;
		const startedAt = Date.now();
		for (;;) {
			if (Date.now() - startedAt > MODEL_COMMAND_TIMEOUT_MS) {
				throw new Error(`Skippr model timed out after ${Math.round(MODEL_COMMAND_TIMEOUT_MS / 1000)}s without completing.`);
			}
			const lines = readBridgeResponseLines(responsePath);
			for (const line of lines.slice(processedLines)) {
				processedLines++;
				const message = parseJsonObject(line);
				if (!message) {
					continue;
				}
				const type = stringField(message, 'type');
				if (type === 'accepted') {
					const dbtOutputPath = stringField(message, 'dbtOutputPath');
					this._emitProgressMarkdown(state.session, turnId, dbtOutputPath ? `Model dbt output: \`${dbtOutputPath}\`.` : 'Model run accepted by the workbench runner.');
					continue;
				}
				if (type === 'log') {
					const logLine = stringField(message, 'line');
					if (logLine) {
						this._logService.info(logLine);
						const progress = modelLogProgressMarkdown(logLine);
						if (progress) {
							this._emitProgressMarkdown(state.session, turnId, progress);
						}
					}
					continue;
				}
				if (type === 'event') {
					const event = objectField(message, 'event');
					if (event) {
						events.push(event);
						const markdown = modelEventMarkdown(event);
						if (markdown) {
							this._emitProgressMarkdown(state.session, turnId, markdown);
						}
					}
					continue;
				}
				if (type === 'file_edit') {
					const fileEdit = await this._fileEditFromBridgeMessage(state.session, turnId, toolCallId, message);
					if (fileEdit) {
						fileEdits.push(fileEdit);
					}
					continue;
				}
				if (type === 'complete') {
					return message;
				}
			}
			await delay(250);
		}
	}

	private async _emitModelSubagentComplete(
		session: URI,
		turnId: string,
		tools: Map<string, ISkipprToolCall>,
		toolCallId: string,
		success: boolean,
		payload: Record<string, unknown>,
		fileEdits: readonly ToolResultFileEditContent[],
		error?: string,
	): Promise<void> {
		this._emitToolStart(session, turnId, tools, {
			tool_id: toolCallId,
			name: 'model_subagent',
			clean_name: 'Model subagent',
			payload,
		});
		const content: ToolResultContent[] = [
			{ type: ToolResultContentType.Text, text: JSON.stringify(payload, null, 2) },
			...fileEdits,
		];
		this._emitAction(session, {
			type: ActionType.SessionToolCallComplete,
			session: session.toString(),
			turnId,
			toolCallId,
			result: {
				success,
				pastTenseMessage: success ? 'Ran Model subagent' : 'Failed Model subagent',
				content,
				structuredContent: payload,
				...(success ? {} : { error: { message: error ?? 'Model subagent failed' } }),
			},
		});
	}

	private async _fileEditFromBridgeMessage(session: URI, turnId: string, toolCallId: string, message: Record<string, unknown>): Promise<ToolResultFileEditContent | undefined> {
		const filePath = stringField(message, 'filePath');
		const beforeContent = typeof message.beforeContent === 'string' ? message.beforeContent : undefined;
		const afterContent = typeof message.afterContent === 'string' ? message.afterContent : undefined;
		if (!filePath || beforeContent === undefined || afterContent === undefined) {
			return undefined;
		}
		const kind = stringField(message, 'changeKind') === 'created'
			? FileEditKind.Create
			: stringField(message, 'changeKind') === 'deleted'
				? FileEditKind.Delete
				: FileEditKind.Edit;
		return this._storeFileEditContent(session, turnId, toolCallId, filePath, kind, beforeContent, afterContent);
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
		const modelEvent = stringField(o, 'event');
		if (modelEvent) {
			const markdown = modelEventMarkdown(o);
			if (markdown) {
				this._emitMarkdown(state.session, turnId, markdown);
			}
			return;
		}

		if (type === 'tool_start') {
			this._emitToolStart(state.session, turnId, tools, o);
			return;
		}
		if (type === 'tool_end') {
			const bridgedModelRequest = modelRequestFromToolEnd(o, state);
			if (bridgedModelRequest) {
				await this._runModelSubagent(state, turnId, bridgedModelRequest, scalarStringField(o, 'tool_id') ?? scalarStringField(o, 'toolId'), false);
				return;
			}
			await this._emitToolEnd(state.session, turnId, tools, o);
			return;
		}
		if (type === 'final') {
			const markdown = stringFieldFromObject(o.result, ['markdown', 'display', 'answer', 'text']);
			if (markdown) {
				this._emitMarkdown(state.session, turnId, markdown);
			}
			this._writeAskQueryResultBridgeMessage(state, o);
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

		return this._storeFileEditContent(
			session,
			turnId,
			toolCallId,
			filePath,
			beforeContent.length === 0 && afterContent.length > 0 ? FileEditKind.Create : FileEditKind.Edit,
			beforeContent,
			afterContent,
		);
	}

	private async _storeFileEditContent(
		session: URI,
		turnId: string,
		toolCallId: string,
		filePath: string,
		kind: FileEditKind,
		beforeContent: string,
		afterContent: string,
	): Promise<ToolResultFileEditContent> {
		const counts = await this._diffCounts(beforeContent, afterContent);
		const ref = this._sessionDataService.openDatabase(session);
		try {
			await ref.object.storeFileEdit({
				turnId,
				toolCallId,
				filePath,
				kind,
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

	private _emitProgressMarkdown(session: URI, turnId: string, content: string): void {
		this._emitMarkdown(session, turnId, `${content.trimEnd()}\n\n`);
	}

	private _emitAction(session: URI, action: SessionAction): void {
		this._onDidSessionProgress.fire({ kind: 'action', session, action });
	}

	private _writeAskQueryResultBridgeMessage(state: ISkipprSession, event: Record<string, unknown>): void {
		if (!state.workspaceRoot) {
			return;
		}
		const result = objectField(event, 'result');
		if (!result || stringField(result, 'kind') !== 'ask') {
			return;
		}
		const payload = objectField(result, 'payload');
		if (!payload || (!payload.data && !payload.sql && !payload.chart)) {
			return;
		}
		const bridgeDir = agentBridgeDirForWorkspace(state.workspaceRoot);
		fs.mkdirSync(bridgeDir, { recursive: true });
		const id = `query-${generateUuid()}`;
		const message = {
			id,
			type: 'queryResults',
			status: 'success',
			source: 'agent',
			pipeline: state.pipeline,
			pipelines_used: stringArrayField(payload, 'pipelines_used'),
			answer: stringField(payload, 'answer') ?? stringField(result, 'display'),
			sql: stringField(payload, 'sql'),
			data: payload.data,
			chart: payload.chart,
		};
		fs.writeFileSync(path.join(bridgeDir, `${id}.query-result.json`), JSON.stringify(message), 'utf8');
	}

	private _writeAskQueryRunningBridgeMessage(state: ISkipprSession, prompt: string): void {
		if (!state.workspaceRoot) {
			return;
		}
		const bridgeDir = agentBridgeDirForWorkspace(state.workspaceRoot);
		fs.mkdirSync(bridgeDir, { recursive: true });
		const id = `query-${generateUuid()}`;
		const message = {
			id,
			type: 'queryResults',
			status: 'running',
			source: 'agent',
			pipeline: state.pipeline,
			question: prompt,
		};
		fs.writeFileSync(path.join(bridgeDir, `${id}.query-result.json`), JSON.stringify(message), 'utf8');
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
	return resolveSkipprCliForIde({
		configuredPath: process.env.SKIPPR_CLI_PATH,
		preferLocalSkipprd: process.env.SKIPPR_USE_LOCAL_SKIPPRD !== '0',
		extraManifestCandidates: [
			path.resolve(moduleDirname, '../../../../../skipprd/Cargo.toml'),
			path.resolve(moduleDirname, '../../../../../../skipprd/Cargo.toml'),
		],
	});
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

function listPipelinesFromConfig(configPath: string | undefined): string[] {
	if (!configPath) {
		return [];
	}
	let text: string;
	try {
		text = fs.readFileSync(configPath, 'utf8');
	} catch {
		return [];
	}
	const lines = text.split(/\r?\n/);
	const out: string[] = [];
	let inPipelines = false;
	let sectionIndent = 0;
	let childIndent: number | undefined;
	for (const raw of lines) {
		const trimmed = raw.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const indent = raw.match(/^(\s*)/)?.[1].length ?? 0;
		const keyMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
		const key = keyMatch?.[1];
		const rest = keyMatch?.[2] ?? '';
		const valuePart = rest.replace(/\s+#.*$/, '').trim();
		if (key === 'pipelines') {
			inPipelines = true;
			sectionIndent = indent;
			childIndent = undefined;
			continue;
		}
		if (!inPipelines) {
			continue;
		}
		if (indent <= sectionIndent) {
			inPipelines = false;
			continue;
		}
		const listPlain = trimmed.match(/^-\s*([a-zA-Z0-9_.-]+)\s*$/);
		if (listPlain) {
			out.push(listPlain[1]);
			childIndent ??= indent;
			continue;
		}
		const listNamed = trimmed.match(/^-\s*name\s*:\s*([a-zA-Z0-9_.-]+)\s*$/i);
		if (listNamed) {
			out.push(listNamed[1]);
			childIndent ??= indent;
			continue;
		}
		if (!keyMatch) {
			continue;
		}
		childIndent ??= indent;
		if (indent !== childIndent || trimmed.startsWith('- ')) {
			continue;
		}
		if (valuePart && valuePart !== '|' && valuePart !== '>' && !valuePart.startsWith('{') && !valuePart.startsWith('[')) {
			continue;
		}
		out.push(key!);
	}
	return [...new Set(out)];
}

function buildIdeChatMessage(prompt: string, state: ISkipprSession): string {
	return JSON.stringify({
		user: prompt,
		execution_surface: 'ide_chat',
		context: {
			workspace_root: state.workspaceRoot,
			config_path: state.configPath,
			pipeline: state.pipeline,
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

function stringArrayField(value: unknown, key: string): string[] | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const field = (value as Record<string, unknown>)[key];
	if (!Array.isArray(field)) {
		return undefined;
	}
	const strings = field
		.filter((item): item is string => typeof item === 'string')
		.map(item => item.trim())
		.filter(Boolean);
	return strings.length ? strings : undefined;
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

function parseModelSlashPrompt(prompt: string, state: ISkipprSession): ModelSlashRequest | undefined {
	const trimmed = prompt.trim();
	if (!/^\/model(?:\s|$)/.test(trimmed)) {
		return undefined;
	}
	const parts = trimmed.split(/\s+/).slice(1);
	let pipeline: string | undefined;
	let noResume = false;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === '--no-resume' || part === '--fresh') {
			noResume = true;
			continue;
		}
		if ((part === '--pipeline' || part === '-p') && parts[i + 1]) {
			pipeline = parts[++i];
			continue;
		}
		if (!part.startsWith('-') && !pipeline) {
			pipeline = part;
		}
	}
	return { pipeline: pipeline ?? state.pipeline, noResume };
}

function modelDbtOutputPath(state: ISkipprSession, pipeline: string): string {
	const root = state.configPath ? path.dirname(state.configPath) : state.workspaceRoot ?? process.cwd();
	return path.join(root, pipeline, 'dbt');
}

function agentBridgeDirForWorkspace(workspaceRoot: string): string {
	const digest = crypto.createHash('sha256').update(path.resolve(workspaceRoot)).digest('hex').slice(0, 24);
	return path.join(os.tmpdir(), 'skippr-ide-agent-bridge', digest);
}

function readBridgeResponseLines(responsePath: string): string[] {
	try {
		return fs.readFileSync(responsePath, 'utf8').split(/\r?\n/).filter(line => line.trim().length > 0);
	} catch {
		return [];
	}
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function modelRequestFromToolEnd(event: Record<string, unknown>, state: ISkipprSession): ModelSlashRequest | undefined {
	const toolName = stringField(event, 'name');
	if (toolName !== 'model_subagent' && toolName !== 'skippr_cli') {
		return undefined;
	}
	const payload = objectField(event, 'payload') ?? objectField(event, 'observation');
	if (payload?.ide_model_run_requested !== true) {
		return undefined;
	}
	const pipeline = stringField(payload, 'pipeline') ?? state.pipeline;
	return {
		pipeline,
		noResume: payload.no_resume === true,
	};
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(line);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function modelEventMarkdown(event: Record<string, unknown>): string | undefined {
	const name = stringField(event, 'event');
	const phase = stringField(event, 'phase');
	const error = stringField(event, 'error') ?? stringField(event, 'failure_summary');
	switch (name) {
		case 'model_start':
			return 'Model workflow started.';
		case 'model_thread_resumed':
			return `Resumed model thread${stringField(event, 'thread_id') ? ` \`${stringField(event, 'thread_id')}\`` : ''}.`;
		case 'model_preflight':
			return event['ok'] === false ? `Model preflight failed: ${error ?? 'unknown error'}` : 'Model preflight passed.';
		case 'model_authoring_start':
			return 'Model authoring started.';
		case 'model_phase_changed':
			return phase ? `Model phase: ${phase}` : undefined;
		case 'model_file_changed':
			return 'Model updated local dbt files.';
		case 'model_complete':
			return 'Model workflow completed.';
		case 'model_error':
			return `Model workflow failed: ${error ?? 'unknown error'}`;
		default:
			return undefined;
	}
}

function modelLogProgressMarkdown(line: string): string | undefined {
	const message = dataEngineerLogMessage(line);
	if (!message) {
		return undefined;
	}
	const lower = message.toLowerCase();
	if (lower.includes('semantic_profile evidence claim ref')) {
		const count = message.match(/attached\s+(\d+)\s+semantic_profile/i)?.[1];
		return count ? `Model planning attached ${count} semantic evidence claim ref(s).` : 'Model planning attached semantic evidence.';
	}
	if (lower.includes('grounding plan against existing staging models')) {
		return 'Model planning is grounding against existing staging models.';
	}
	if (lower.includes('validating plan')) {
		return 'Model planning is validating the candidate plan.';
	}
	if (lower.includes('deterministic staging discovery sufficient for model plan')) {
		const count = message.match(/\((\d+)\s+staging model/i)?.[1];
		return count
			? `Model planning found ${count} staging model(s); skipping extra discovery.`
			: 'Model planning found enough staging evidence; skipping extra discovery.';
	}
	if (lower.includes('compiling plan from candidate models')) {
		return 'Model planning is compiling the plan from candidate models.';
	}
	if (lower.includes('enrichment chunk start')) {
		const chunk = message.match(/chunk="?(\d+)"?/i)?.[1];
		const total = message.match(/\bof="?(\d+)"?/i)?.[1];
		return chunk && total ? `Model enrichment chunk ${chunk}/${total} started.` : 'Model enrichment chunk started.';
	}
	if (lower.includes('enrichment chunk complete')) {
		const chunk = message.match(/chunk="?(\d+)"?/i)?.[1];
		const total = message.match(/\bof="?(\d+)"?/i)?.[1];
		return chunk && total ? `Model enrichment chunk ${chunk}/${total} completed.` : 'Model enrichment chunk completed.';
	}
	if (lower.includes('enrichment loop complete')) {
		return 'Model enrichment completed.';
	}
	return undefined;
}

function dataEngineerLogMessage(line: string): string | undefined {
	if (!line.includes('data_engineer:')) {
		return undefined;
	}
	const message = line.slice(line.indexOf('data_engineer:') + 'data_engineer:'.length).trim();
	return message || undefined;
}

function modelSubagentSummary(events: readonly Record<string, unknown>[], pipeline: string, dbtOutputPath: string, error?: string): Record<string, unknown> {
	const terminalEvent = [...events].reverse().find(event => {
		const name = stringField(event, 'event');
		return name === 'model_complete' || name === 'model_error';
	});
	const changedFiles = events
		.filter(event => stringField(event, 'event') === 'model_file_changed')
		.map(event => event['changed_files'])
		.filter(Boolean);
	return {
		pipeline,
		dbt_output_path: dbtOutputPath,
		ok: !error && stringField(terminalEvent, 'event') !== 'model_error',
		error,
		terminal_event: terminalEvent,
		event_count: events.length,
		changed_files: changedFiles,
	};
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

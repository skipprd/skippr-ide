/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DisposableStore, type IReference } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ILogService, NullLogService } from '../../../log/common/log.js';
import { IInstantiationService } from '../../../instantiation/common/instantiation.js';
import { InstantiationService } from '../../../instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../../instantiation/common/serviceCollection.js';
import { IDiffComputeService } from '../../common/diffComputeService.js';
import type { AgentSignal } from '../../common/agentService.js';
import { ISessionDatabase, ISessionDataService } from '../../common/sessionDataService.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { SessionInputQuestionKind, ToolResultContentType } from '../../common/state/sessionState.js';
import { SessionDatabase } from '../../node/sessionDatabase.js';
import { SkipprCliAgent } from '../../node/skipprCliAgent.js';
import { createZeroDiffComputeService } from '../common/sessionTestHelpers.js';

suite('SkipprCliAgent', () => {
	const disposables = new DisposableStore();
	let db: SessionDatabase;
	let agent: SkipprCliAgent;

	setup(async () => {
		db = disposables.add(await SessionDatabase.open(':memory:'));
		const sessionDataService: ISessionDataService = {
			_serviceBrand: undefined,
			getSessionDataDir: () => URI.file('/session-data'),
			getSessionDataDirById: () => URI.file('/session-data'),
			openDatabase: (): IReference<ISessionDatabase> => ({ object: db, dispose: () => { } }),
			tryOpenDatabase: async (): Promise<IReference<ISessionDatabase> | undefined> => ({ object: db, dispose: () => { } }),
			deleteSessionData: async () => { },
			cleanupOrphanedData: async () => { },
			whenIdle: async () => { },
		};
		const services = new ServiceCollection();
		services.set(ISessionDataService, sessionDataService);
		services.set(ILogService, new NullLogService());
		services.set(IDiffComputeService, createZeroDiffComputeService());
		const instantiationService: IInstantiationService = disposables.add(new InstantiationService(services));
		agent = disposables.add(instantiationService.createInstance(SkipprCliAgent));
	});

	teardown(async () => {
		disposables.clear();
		await db.close();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps normalized local_ide patch JSONL to file-edit tool completion', async () => {
		const created = await agent.createSession({
			config: {
				configPath: '/workspace/skippr.yml',
				pipeline: 'dave',
				mode: 'agent',
			},
		});
		const state = (agent as unknown as { _sessions: Map<string, unknown> })._sessions.get(created.session.toString());
		assert.ok(state);

		const signals: AgentSignal[] = [];
		const sub = agent.onDidSessionProgress(signal => signals.push(signal));
		disposables.add(sub);

		const tools = new Map<string, unknown>();
		await (agent as unknown as {
			_handleJsonlLine(state: unknown, turnId: string, tools: Map<string, unknown>, line: string): Promise<void>;
		})._handleJsonlLine(state, 'turn-1', tools, JSON.stringify({
			type: 'tool_end',
			name: 'local_ide',
			clean_name: 'Local Ide',
			tool_id: 'tc-local',
			status: 'ok',
			payload: {
				no_op: false,
				absolute_path: '/workspace/skippr.yml',
				before_content: 'old\n',
				after_content: 'new\n',
			},
		}));

		const complete = signals
			.filter((signal): signal is Extract<AgentSignal, { kind: 'action' }> => signal.kind === 'action')
			.map(signal => signal.action)
			.find(action => action.type === ActionType.SessionToolCallComplete);
		assert.ok(complete);
		const fileEdit = complete.result.content?.find(item => item.type === ToolResultContentType.FileEdit);
		assert.ok(fileEdit);
		assert.strictEqual(complete.result.pastTenseMessage, 'Edited skippr.yml');
		assert.strictEqual(fileEdit.before?.uri, 'file:///workspace/skippr.yml');
		assert.strictEqual(fileEdit.after?.uri, 'file:///workspace/skippr.yml');

		const stored = await db.readFileEditContent('tc-local', '/workspace/skippr.yml');
		assert.ok(stored);
		assert.strictEqual(new TextDecoder().decode(stored.beforeContent), 'old\n');
		assert.strictEqual(new TextDecoder().decode(stored.afterContent), 'new\n');
	});

	test('does not surface LLM lifecycle events as chat content', async () => {
		const created = await agent.createSession({ config: { mode: 'agent' } });
		const state = (agent as unknown as { _sessions: Map<string, unknown> })._sessions.get(created.session.toString());
		assert.ok(state);

		const signals: AgentSignal[] = [];
		const sub = agent.onDidSessionProgress(signal => signals.push(signal));
		disposables.add(sub);

		const tools = new Map<string, unknown>();
		await (agent as unknown as {
			_handleJsonlLine(state: unknown, turnId: string, tools: Map<string, unknown>, line: string): Promise<void>;
		})._handleJsonlLine(state, 'turn-1', tools, JSON.stringify({
			type: 'llm_start',
			model: 'gpt-5.4',
		}));
		await (agent as unknown as {
			_handleJsonlLine(state: unknown, turnId: string, tools: Map<string, unknown>, line: string): Promise<void>;
		})._handleJsonlLine(state, 'turn-1', tools, JSON.stringify({
			type: 'llm_end',
			model: 'gpt-5.4',
		}));

		const responseParts = signals
			.filter((signal): signal is Extract<AgentSignal, { kind: 'action' }> => signal.kind === 'action')
			.map(signal => signal.action)
			.filter(action => action.type === ActionType.SessionResponsePart);
		assert.strictEqual(responseParts.length, 0);
	});

	test('maps local_ide read completion to user-facing wording', async () => {
		const created = await agent.createSession({ config: { mode: 'agent' } });
		const state = (agent as unknown as { _sessions: Map<string, unknown> })._sessions.get(created.session.toString());
		assert.ok(state);

		const signals: AgentSignal[] = [];
		const sub = agent.onDidSessionProgress(signal => signals.push(signal));
		disposables.add(sub);

		const tools = new Map<string, unknown>();
		await (agent as unknown as {
			_handleJsonlLine(state: unknown, turnId: string, tools: Map<string, unknown>, line: string): Promise<void>;
		})._handleJsonlLine(state, 'turn-1', tools, JSON.stringify({
			type: 'tool_end',
			name: 'local_ide',
			clean_name: 'Local Ide',
			tool_id: 'tc-read',
			status: 'ok',
			payload: {
				path: '/workspace/skippr.yml',
				content: 'project: demo\n',
			},
		}));

		const complete = signals
			.filter((signal): signal is Extract<AgentSignal, { kind: 'action' }> => signal.kind === 'action')
			.map(signal => signal.action)
			.find(action => action.type === ActionType.SessionToolCallComplete);
		assert.ok(complete);
		assert.strictEqual(complete.result.pastTenseMessage, 'Read skippr.yml');
		assert.deepStrictEqual(complete.result.content, [{ type: ToolResultContentType.Text, text: 'Read skippr.yml' }]);
	});

	test('sendMessage works without workspace config or pipeline', async () => {
		const oldCliPath = process.env.SKIPPR_CLI_PATH;
		process.env.SKIPPR_CLI_PATH = 'skippr';
		const created = await agent.createSession({
			workingDirectory: URI.file('/workspace/no-config'),
			config: {
				mode: 'agent',
			},
		});

		let capturedArgs: string[] | undefined;
		let capturedCwd: string | undefined;
		(agent as unknown as {
			_runCli(state: unknown, turnId: string, command: string, commandArgs: string[], cwd: string): Promise<void>;
		})._runCli = async (_state, _turnId, _command, commandArgs, cwd) => {
			capturedArgs = commandArgs;
			capturedCwd = cwd;
		};

		try {
			await agent.sendMessage(created.session, 'hello', [], 'turn-1');
		} finally {
			if (oldCliPath === undefined) {
				delete process.env.SKIPPR_CLI_PATH;
			} else {
				process.env.SKIPPR_CLI_PATH = oldCliPath;
			}
		}

		assert.ok(capturedArgs, 'expected Skippr CLI to be invoked');
		assert.ok(!capturedArgs.includes('--config'), 'chat without workspace config must not pass --config');
		assert.ok(!capturedArgs.includes('--pipeline'), 'chat without a selected pipeline must not pass --pipeline');
		assert.ok(capturedArgs.includes('chat'));
		assert.ok(capturedArgs.includes('send'));
		assert.strictEqual(capturedCwd, '/workspace/no-config');
	});

	test('sendMessage passes config without silently inferring pipeline', async () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skippr-cli-agent-'));
		const oldCliPath = process.env.SKIPPR_CLI_PATH;
		process.env.SKIPPR_CLI_PATH = 'skippr';
		fs.writeFileSync(path.join(workspaceRoot, 'skippr.yml'), 'pipelines:\n  bikehire:\n    source: demo\n');
		const created = await agent.createSession({
			workingDirectory: URI.file(workspaceRoot),
			config: {
				mode: 'agent',
			},
		});

		let capturedArgs: string[] | undefined;
		(agent as unknown as {
			_runCli(state: unknown, turnId: string, command: string, commandArgs: string[], cwd: string): Promise<void>;
		})._runCli = async (_state, _turnId, _command, commandArgs) => {
			capturedArgs = commandArgs;
		};

		try {
			await agent.sendMessage(created.session, 'hello', [], 'turn-1');
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
			if (oldCliPath === undefined) {
				delete process.env.SKIPPR_CLI_PATH;
			} else {
				process.env.SKIPPR_CLI_PATH = oldCliPath;
			}
		}

		assert.ok(capturedArgs, 'expected Skippr CLI to be invoked');
		assert.deepStrictEqual(capturedArgs.slice(0, 4), ['--config', path.join(workspaceRoot, 'skippr.yml'), 'chat', 'send']);
		assert.ok(!capturedArgs.includes('--pipeline'), 'chat without selected pipeline must not pass --pipeline');
		const messageIndex = capturedArgs.indexOf('--message');
		assert.ok(messageIndex >= 0);
		const message = JSON.parse(capturedArgs[messageIndex + 1]);
		assert.strictEqual(message.context.config_path, path.join(workspaceRoot, 'skippr.yml'));
		assert.strictEqual(message.context.pipeline, undefined);
	});

	test('ChatSummary sets threadId for follow-up sendMessage', async () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skippr-cli-agent-thread-'));
		const oldCliPath = process.env.SKIPPR_CLI_PATH;
		process.env.SKIPPR_CLI_PATH = 'skippr';
		fs.writeFileSync(path.join(workspaceRoot, 'skippr.yml'), 'pipelines:\n  bike_hire:\n    source: demo\n');
		const created = await agent.createSession({
			workingDirectory: URI.file(workspaceRoot),
			config: { configPath: path.join(workspaceRoot, 'skippr.yml'), pipeline: 'bike_hire', mode: 'ask' },
		});
		const state = (agent as unknown as { _sessions: Map<string, { threadId?: string }> })._sessions.get(created.session.toString());
		assert.ok(state);

		const tools = new Map<string, unknown>();
		await (agent as unknown as {
			_handleJsonlLine(state: unknown, turnId: string, tools: Map<string, unknown>, line: string): Promise<void>;
		})._handleJsonlLine(state, 'turn-1', tools, JSON.stringify({
			type: 'ChatSummary',
			thread_id: '11111111-1111-4111-8111-111111111111',
			ok: true,
		}));

		let capturedArgs: string[] | undefined;
		(agent as unknown as {
			_runCli(state: unknown, turnId: string, command: string, commandArgs: string[], cwd: string): Promise<void>;
		})._runCli = async (_state, _turnId, _command, commandArgs) => {
			capturedArgs = commandArgs;
		};

		try {
			await agent.sendMessage(created.session, 'follow-up question', [], 'turn-2');
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
			if (oldCliPath === undefined) {
				delete process.env.SKIPPR_CLI_PATH;
			} else {
				process.env.SKIPPR_CLI_PATH = oldCliPath;
			}
		}

		assert.strictEqual(state.threadId, '11111111-1111-4111-8111-111111111111');
		assert.ok(capturedArgs?.includes('--thread'));
		const threadIndex = capturedArgs!.indexOf('--thread');
		assert.strictEqual(capturedArgs![threadIndex + 1], '11111111-1111-4111-8111-111111111111');
	});

	test('thread_assigned sets threadId before ChatSummary', async () => {
		const created = await agent.createSession({
			config: { mode: 'ask', pipeline: 'bike_hire' },
		});
		const state = (agent as unknown as { _sessions: Map<string, { threadId?: string }> })._sessions.get(created.session.toString());
		assert.ok(state);

		const tools = new Map<string, unknown>();
		await (agent as unknown as {
			_handleJsonlLine(state: unknown, turnId: string, tools: Map<string, unknown>, line: string): Promise<void>;
		})._handleJsonlLine(state, 'turn-1', tools, JSON.stringify({
			type: 'thread_assigned',
			thread_id: '22222222-2222-4222-8222-222222222222',
		}));

		assert.strictEqual(state.threadId, '22222222-2222-4222-8222-222222222222');
	});

	test('await_user emits SessionInputRequested', async () => {
		const created = await agent.createSession({ config: { mode: 'ask' } });
		const state = (agent as unknown as { _sessions: Map<string, unknown> })._sessions.get(created.session.toString());
		assert.ok(state);

		const signals: AgentSignal[] = [];
		const sub = agent.onDidSessionProgress(signal => signals.push(signal));
		disposables.add(sub);

		const tools = new Map<string, unknown>();
		await (agent as unknown as {
			_handleJsonlLine(state: unknown, turnId: string, tools: Map<string, unknown>, line: string): Promise<void>;
		})._handleJsonlLine(state, 'turn-1', tools, JSON.stringify({
			type: 'await_user',
			prompt: 'Which date range should I use?',
		}));

		const inputRequested = signals
			.filter((signal): signal is Extract<AgentSignal, { kind: 'action' }> => signal.kind === 'action')
			.map(signal => signal.action)
			.find(action => action.type === ActionType.SessionInputRequested);
		assert.ok(inputRequested);
		assert.strictEqual(inputRequested.request.questions?.[0]?.kind, SessionInputQuestionKind.Text);
	});
});

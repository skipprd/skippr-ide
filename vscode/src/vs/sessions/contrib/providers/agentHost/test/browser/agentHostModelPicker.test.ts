/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import type { ILanguageModelChatMetadataAndIdentifier } from '../../../../../../workbench/contrib/chat/common/languageModels.js';
import { agentHostModelPickerStorageKey, resolveAgentHostModel } from '../../browser/agentHostModelPicker.js';

function makeModel(identifier: string): ILanguageModelChatMetadataAndIdentifier {
	return {
		identifier,
		metadata: {
			extension: new ExtensionIdentifier('test.ext'),
			id: identifier,
			name: identifier,
			vendor: 'skippr',
			version: '1.0',
			family: 'skippr',
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
			isUserSelectable: true,
			modelPickerCategory: undefined,
			targetChatSessionType: 'agent-host-skipprcli',
		},
	};
}

suite('AgentHostModelPicker', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses resource-scheme-scoped storage keys', () => {
		assert.strictEqual(
			agentHostModelPickerStorageKey('agent-host-skipprcli'),
			'workbench.agentsession.agentHostModelPicker.agent-host-skipprcli.selectedModelId',
		);
		assert.strictEqual(
			agentHostModelPickerStorageKey('remote-localhost__4321-skipprcli'),
			'workbench.agentsession.agentHostModelPicker.remote-localhost__4321-skipprcli.selectedModelId',
		);
	});

	test('uses the current session model from session state', () => {
		const models = [
			makeModel('agent-host-skipprcli:other'),
			makeModel('agent-host-skipprcli:session'),
		];

		assert.strictEqual(
			resolveAgentHostModel(models, 'agent-host-skipprcli:session', 'agent-host-skipprcli:other'),
			models[1],
		);
	});

	test('does not synthesize a model for existing sessions without one in state', () => {
		const models = [
			makeModel('agent-host-skipprcli:first'),
		];

		assert.strictEqual(resolveAgentHostModel(models, undefined, undefined), undefined);
	});

	test('uses the stored model for new untitled sessions with no model yet', () => {
		const models = [
			makeModel('agent-host-skipprcli:first'),
			makeModel('agent-host-skipprcli:stored'),
		];

		assert.strictEqual(resolveAgentHostModel(models, undefined, 'agent-host-skipprcli:stored'), models[1]);
	});

	test('does not fall back to the first model for new untitled sessions without stored state', () => {
		const models = [
			makeModel('agent-host-skipprcli:first'),
		];

		assert.strictEqual(resolveAgentHostModel(models, undefined, undefined), undefined);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { AgentSession } from '../../common/agentService.js';

suite('AgentSession namespace', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('uri creates a URI with provider as scheme and id as path', () => {
		const session = AgentSession.uri('skippr', 'abc-123');
		assert.strictEqual(session.scheme, 'skippr');
		assert.strictEqual(session.path, '/abc-123');
	});

	test('id extracts the raw session ID from a session URI', () => {
		const session = URI.from({ scheme: 'skippr', path: '/my-session-42' });
		assert.strictEqual(AgentSession.id(session), 'my-session-42');
	});

	test('uri and id are inverse operations', () => {
		const rawId = 'test-session-xyz';
		const session = AgentSession.uri('skippr', rawId);
		assert.strictEqual(AgentSession.id(session), rawId);
	});

	test('provider extracts skippr from a skippr-scheme URI', () => {
		const session = AgentSession.uri('skippr', 'sess-1');
		assert.strictEqual(AgentSession.provider(session), 'skippr');
	});
});

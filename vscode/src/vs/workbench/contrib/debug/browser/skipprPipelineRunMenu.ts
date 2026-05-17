/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDomNodePagePosition } from '../../../../base/browser/dom.js';
import { Separator } from '../../../../base/common/actions.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Action2, IMenuService, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

/** Matches `contributes.submenus[].id` → `MenuId.for('api:…')` in skippr-workbench. */
const SkipprPipelineRunMenuId = MenuId.for('api:skippr.pipelineRun');

export const SKIPPR_SHOW_PIPELINE_RUN_MENU_COMMAND_ID = 'skippr.showPipelineRunMenu';

registerAction2(class SkipprShowPipelineRunMenuAction extends Action2 {
	constructor() {
		super({
			id: SKIPPR_SHOW_PIPELINE_RUN_MENU_COMMAND_ID,
			title: { value: 'Show Skippr pipeline run menu', original: 'Show Skippr pipeline run menu' },
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, lineNumberArg?: number): Promise<void> {
		const editorService = accessor.get(ICodeEditorService);
		const editor = editorService.getActiveCodeEditor();
		if (!editor) {
			return;
		}

		const model = editor.getModel();
		if (!model) {
			return;
		}

		let lineNumber = typeof lineNumberArg === 'number' ? lineNumberArg : editor.getPosition()?.lineNumber;
		if (lineNumber === undefined || lineNumber < 1) {
			lineNumber = 1;
		}
		lineNumber = Math.min(lineNumber, model.getLineCount());

		const menuService = accessor.get(IMenuService);
		const contextKeyService = accessor.get(IContextKeyService);
		const menu = menuService.createMenu(SkipprPipelineRunMenuId, contextKeyService);

		const contextMenuService = accessor.get(IContextMenuService);
		const layout = editor.getLayoutInfo();
		const lineHeight = editor.getOption(EditorOption.lineHeight);
		const top = editor.getTopForLineNumber(lineNumber);
		const scrollTop = editor.getScrollTop();
		const domNode = editor.getDomNode();
		if (!domNode) {
			menu.dispose();
			return;
		}
		const editorPos = getDomNodePagePosition(domNode);
		const anchorX = editorPos.left + layout.glyphMarginWidth + layout.lineNumbersWidth + 48;
		const anchorY = editorPos.top + top - scrollTop + lineHeight;

		contextMenuService.showContextMenu({
			getAnchor: () => ({ x: anchorX, y: anchorY }),
			getActions: () => {
				const groups = menu.getActions({ shouldForwardArgs: true });
				return Separator.join(...groups.map(([, actions]) => actions));
			},
			onHide: () => menu.dispose(),
		});
	}
});

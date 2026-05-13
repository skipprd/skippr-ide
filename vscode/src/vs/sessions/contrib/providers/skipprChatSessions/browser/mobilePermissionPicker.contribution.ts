/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IActionViewItemService } from '../../../../../platform/actions/browser/actionViewItemService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { Menus } from '../../../../browser/menus.js';
import { PickerActionViewItem } from './skipprChatSessionsActions.js';
import { MobilePermissionPicker } from './mobilePermissionPicker.js';
import { SkipprPermissionPickerDelegate } from './permissionPicker.js';

/**
 * Web-only contribution that registers the mobile-aware
 * {@link MobilePermissionPicker} for the Skippr Agent permission picker
 * action. The desktop contribution
 * (`SkipprPickerActionViewItemContribution` in
 * `skipprChatSessionsActions.ts`) skips this picker when `isWeb`, so
 * there is no duplicate-registration conflict. Imported only from
 * `sessions.web.main.ts`.
 *
 * On phone-layout viewports `MobilePermissionPicker.showPicker()`
 * routes the Default/Bypass/Autopilot choice through a bottom sheet;
 * on tablet/desktop web viewports it falls through to the inherited
 * desktop action-widget popup.
 */
class SkipprPermissionPickerWebContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.skipprPermissionPickerWeb';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(actionViewItemService.register(
			Menus.NewSessionControl,
			'sessions.defaultSkippr.permissionPicker',
			() => {
				const delegate = instantiationService.createInstance(SkipprPermissionPickerDelegate);
				const picker = instantiationService.createInstance(MobilePermissionPicker, delegate);
				return new PickerActionViewItem(picker, delegate);
			},
		));
	}
}

registerWorkbenchContribution2(SkipprPermissionPickerWebContribution.ID, SkipprPermissionPickerWebContribution, WorkbenchPhase.AfterRestored);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISkipprTokenInfo, IDefaultAccount, IDefaultAccountAuthenticationProvider, IPolicyData } from '../../../base/common/defaultAccount.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface IDefaultAccountProvider {
	readonly defaultAccount: IDefaultAccount | null;
	readonly onDidChangeDefaultAccount: Event<IDefaultAccount | null>;
	readonly policyData: IPolicyData | null;
	readonly onDidChangePolicyData: Event<IPolicyData | null>;
	readonly skipprTokenInfo: ISkipprTokenInfo | null;
	readonly onDidChangeSkipprTokenInfo: Event<ISkipprTokenInfo | null>;
	getDefaultAccountAuthenticationProvider(): IDefaultAccountAuthenticationProvider;
	refresh(options?: { forceRefresh?: boolean }): Promise<IDefaultAccount | null>;
	signIn(options?: { additionalScopes?: readonly string[];[key: string]: unknown }): Promise<IDefaultAccount | null>;
	signOut(): Promise<void>;
}

export const IDefaultAccountService = createDecorator<IDefaultAccountService>('defaultAccountService');

export interface IDefaultAccountService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeDefaultAccount: Event<IDefaultAccount | null>;
	readonly onDidChangePolicyData: Event<IPolicyData | null>;
	readonly policyData: IPolicyData | null;
	readonly currentDefaultAccount: IDefaultAccount | null;
	readonly skipprTokenInfo: ISkipprTokenInfo | null;
	readonly onDidChangeSkipprTokenInfo: Event<ISkipprTokenInfo | null>;
	getDefaultAccount(): Promise<IDefaultAccount | null>;
	getDefaultAccountAuthenticationProvider(): IDefaultAccountAuthenticationProvider;
	setDefaultAccountProvider(provider: IDefaultAccountProvider): void;
	refresh(options?: { forceRefresh?: boolean }): Promise<IDefaultAccount | null>;
	signIn(options?: { additionalScopes?: readonly string[];[key: string]: unknown }): Promise<IDefaultAccount | null>;
	signOut(): Promise<void>;
}

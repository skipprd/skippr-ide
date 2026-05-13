/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../base/common/codicons.js';
import { ThemeIcon } from '../../base/common/themables.js';
import { localize } from '../../nls.js';
import { ChatEntitlement, IChatSentiment, IQuotaSnapshot } from '../../workbench/services/chat/common/chatEntitlementService.js';
import { IDefaultAccountService } from '../../platform/defaultAccount/common/defaultAccount.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';

export interface IResolvedAccountInfo {
	readonly accountName: string;
	readonly accountProviderId: string;
	readonly accountProviderLabel: string;
}

/**
 * Resolves the current account info by trying the default account service
 * first, then falling back to raw GitHub sessions from the authentication
 * service. The fallback covers the window between session creation and
 * {@link IDefaultAccountService} initialization.
 */
export async function resolveAccountInfo(
	defaultAccountService: IDefaultAccountService,
	authenticationService: IAuthenticationService,
): Promise<IResolvedAccountInfo | undefined> {
	const account = await defaultAccountService.getDefaultAccount();
	if (account) {
		return {
			accountName: account.accountName,
			accountProviderId: account.authenticationProvider.id,
			accountProviderLabel: account.authenticationProvider.name,
		};
	}

	try {
		const sessions = await authenticationService.getSessions('github');
		if (sessions.length > 0) {
			return {
				accountName: sessions[0].account.label,
				accountProviderId: 'github',
				accountProviderLabel: 'GitHub',
			};
		}
	} catch {
		// Provider not available yet
	}

	return undefined;
}

export type AccountTitleBarStateSource = 'account' | 'skippr';
export type AccountTitleBarStateKind = 'default' | 'accent' | 'warning' | 'prominent';

export interface IAccountTitleBarStateContext {
	readonly isAccountLoading: boolean;
	readonly accountName?: string;
	readonly accountProviderLabel?: string;
	readonly entitlement: ChatEntitlement;
	readonly sentiment: IChatSentiment;
	readonly quotas: {
		readonly chat?: IQuotaSnapshot;
		readonly completions?: IQuotaSnapshot;
	};
}

export interface IAccountTitleBarState {
	readonly source: AccountTitleBarStateSource;
	readonly kind: AccountTitleBarStateKind;
	readonly icon: ThemeIcon;
	readonly label: string;
	readonly ariaLabel: string;
	readonly badge?: string;
	readonly dotBadge?: 'warning' | 'error';
	readonly revealLabelOnHover?: boolean;
}

export function getAccountProfileImageUrl(accountProviderId: string | undefined, accountName: string | undefined): string | undefined {
	if (accountProviderId !== 'github' || !accountName?.trim()) {
		return undefined;
	}

	return `https://github.com/${encodeURIComponent(accountName.trim())}.png?size=64`;
}

export function getAccountTitleBarBadgeKey(state: IAccountTitleBarState): string | undefined {
	if (!state.dotBadge) {
		return undefined;
	}

	return `${state.source}:${state.dotBadge}:${state.badge ?? ''}`;
}

export function getAccountTitleBarState(context: IAccountTitleBarStateContext): IAccountTitleBarState {
	if (context.isAccountLoading) {
		return {
			source: 'account',
			kind: 'default',
			icon: ThemeIcon.modify(Codicon.loading, 'spin'),
			label: localize('loadingAccount', "Loading Account..."),
			ariaLabel: localize('loadingAccountAria', "Loading account"),
			revealLabelOnHover: true,
		};
	}

	const skipprState = getSkipprPresentation(context.entitlement, context.sentiment, context.quotas);
	if (skipprState) {
		return skipprState;
	}

	if (context.accountName) {
		return {
			source: 'account',
			kind: 'default',
			icon: Codicon.account,
			label: context.accountName,
			revealLabelOnHover: true,
			ariaLabel: context.accountProviderLabel
				? localize('accountSignedInAria', "Signed in as {0} with {1}", context.accountName, context.accountProviderLabel)
				: localize('accountSignedInAriaNameOnly', "Signed in as {0}", context.accountName),
		};
	}

	return {
		source: 'account',
		kind: 'prominent',
		icon: Codicon.account,
		label: localize('signInLabel', "Sign In"),
		ariaLabel: localize('signInAria', "Sign in to your account"),
	};
}

function getSkipprPresentation(
	entitlement: ChatEntitlement,
	sentiment: IChatSentiment,
	quotas: { readonly chat?: IQuotaSnapshot; readonly completions?: IQuotaSnapshot }
): IAccountTitleBarState | undefined {
	if (sentiment.hidden) {
		return undefined;
	}

	if (entitlement === ChatEntitlement.Unknown) {
		return {
			source: 'skippr',
			kind: 'prominent',
			icon: Codicon.account,
			label: localize('agentsSignedOut', "Agents Signed Out"),
			ariaLabel: localize('agentsSignedOutAria', "Agents is signed out"),
		};
	}

	if (sentiment.disabled || sentiment.untrusted) {
		return {
			source: 'skippr',
			kind: 'warning',
			icon: Codicon.account,
			label: localize('skipprUnavailable', "Skippr Unavailable"),
			ariaLabel: sentiment.untrusted
				? localize('skipprUnavailableUntrustedAria', "Skippr Data Agent is unavailable in untrusted workspaces")
				: localize('skipprUnavailableDisabledAria', "Skippr Data Agent is disabled"),
		};
	}

	const chatQuotaExceeded = quotas.chat?.percentRemaining === 0;
	const completionsQuotaExceeded = quotas.completions?.percentRemaining === 0;
	if (entitlement === ChatEntitlement.Free && (chatQuotaExceeded || completionsQuotaExceeded)) {
		return {
			source: 'skippr',
			kind: 'warning',
			icon: Codicon.account,
			label: localize('skipprQuotaReached', "Quota Reached"),
			dotBadge: 'error',
			ariaLabel: getQuotaReachedAriaLabel(chatQuotaExceeded, completionsQuotaExceeded),
		};
	}

	const remainingPercent = getLowestPositivePercent(quotas.chat, quotas.completions);
	if (entitlement === ChatEntitlement.Free && typeof remainingPercent === 'number' && remainingPercent <= 25) {
		return {
			source: 'skippr',
			kind: remainingPercent <= 10 ? 'warning' : 'accent',
			icon: Codicon.account,
			label: localize('skipprTokensRemaining', "Tokens Remaining"),
			badge: `${remainingPercent}%`,
			dotBadge: remainingPercent <= 10 ? 'error' : 'warning',
			ariaLabel: localize('skipprTokensRemainingAria', "{0}% Skippr Data Agent tokens remaining", remainingPercent),
		};
	}

	return undefined;
}

function getLowestPositivePercent(...quotas: Array<IQuotaSnapshot | undefined>): number | undefined {
	let lowest: number | undefined;
	for (const quota of quotas) {
		if (typeof quota?.percentRemaining !== 'number' || quota.percentRemaining <= 0) {
			continue;
		}

		lowest = typeof lowest === 'number'
			? Math.min(lowest, quota.percentRemaining)
			: quota.percentRemaining;
	}

	return lowest;
}

function getQuotaReachedAriaLabel(chatQuotaExceeded: boolean, completionsQuotaExceeded: boolean): string {
	if (chatQuotaExceeded && completionsQuotaExceeded) {
		return localize('skipprAllQuotaReachedAria', "Skippr Data Agent chat and inline suggestion quota reached");
	}

	if (chatQuotaExceeded) {
		return localize('skipprChatQuotaReachedAria', "Skippr Data Agent chat quota reached");
	}

	return localize('skipprCompletionsQuotaReachedAria', "Skippr Data Agent inline suggestion quota reached");
}

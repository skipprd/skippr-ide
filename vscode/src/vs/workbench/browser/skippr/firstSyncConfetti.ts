/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CodeWindow } from '../../../base/browser/window.js';

const confettiColors = [
	'#007acc',
	'#005a9e',
	'#0098ff',
	'#4fc3f7',
	'#64b5f6',
	'#42a5f5',
	'#e040fb',
	'#ffca28',
	'#66bb6a',
];

const PARTICLE_COUNT = 100;
const DURATION_MS = 3500;

let activeOverlay: HTMLElement | undefined;

/**
 * Full-viewport falling confetti for a pipeline's first sync start.
 */
export function playSkipprFirstSyncConfetti(targetWindow: CodeWindow): void {
	if (activeOverlay) {
		return;
	}

	const doc = targetWindow.document;
	const overlay = doc.createElement('div');
	overlay.className = 'skippr-first-sync-confetti';
	overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:100000;overflow:hidden;';
	activeOverlay = overlay;

	const style = doc.createElement('style');
	style.textContent = `
@keyframes skipprConfettiFall {
	0% {
		transform: translate3d(0, -12vh, 0) rotate(0deg);
		opacity: 1;
	}
	100% {
		transform: translate3d(var(--drift, 0px), 110vh, 0) rotate(var(--spin, 360deg));
		opacity: 0.15;
	}
}
.skippr-first-sync-confetti .particle {
	position: absolute;
	top: -16px;
	will-change: transform, opacity;
	animation: skipprConfettiFall var(--fall-duration, 2.8s) linear forwards;
	animation-delay: var(--fall-delay, 0s);
}
`;
	overlay.appendChild(style);

	for (let i = 0; i < PARTICLE_COUNT; i++) {
		const particle = doc.createElement('div');
		particle.className = 'particle';
		const size = 4 + (i % 5) * 2;
		const left = Math.random() * 100;
		const drift = (Math.random() - 0.5) * 120;
		const spin = (Math.random() - 0.5) * 720;
		const fallDuration = 2.2 + Math.random() * 1.6;
		const fallDelay = Math.random() * 1.2;
		const color = confettiColors[i % confettiColors.length];
		const isCircle = i % 3 === 0;

		particle.style.width = `${size}px`;
		particle.style.height = isCircle ? `${size}px` : `${size * 0.55}px`;
		particle.style.left = `${left}%`;
		particle.style.backgroundColor = color;
		particle.style.borderRadius = isCircle ? '50%' : '1px';
		particle.style.setProperty('--drift', `${drift}px`);
		particle.style.setProperty('--spin', `${spin}deg`);
		particle.style.setProperty('--fall-duration', `${fallDuration}s`);
		particle.style.setProperty('--fall-delay', `${fallDelay}s`);
		overlay.appendChild(particle);
	}

	doc.body.appendChild(overlay);

	targetWindow.setTimeout(() => {
		overlay.remove();
		if (activeOverlay === overlay) {
			activeOverlay = undefined;
		}
	}, DURATION_MS);
}

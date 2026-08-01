import { setIcon } from 'obsidian';

/**
 * The game-modes segmented pill: Solo (red) · Co-op (green) · Multi (blue). Each segment carries a
 * Lucide icon plus its label and toggles independently, since a game may offer any combination.
 * Shared by the Add-game modal and the Game detail modal.
 */
export interface GameModes {
	singleplayer: boolean;
	coop: boolean;
	multiplayer: boolean;
}

const SEGMENTS: Array<{ key: keyof GameModes; cls: string; icon: string; label: string; title: string }> = [
	{ key: 'singleplayer', cls: 'wl-mode-pill-solo', icon: 'user', label: 'Solo', title: 'Singleplayer' },
	{ key: 'coop', cls: 'wl-mode-pill-coop', icon: 'users', label: 'Co-op', title: 'Co-operative' },
	{ key: 'multiplayer', cls: 'wl-mode-pill-multi', icon: 'globe', label: 'Multi', title: 'Multiplayer' },
];

export function renderModePill(
	parent: HTMLElement,
	get: () => GameModes,
	set: (patch: Partial<GameModes>) => void,
): HTMLElement {
	const pill = parent.createDiv({ cls: 'wl-mode-pill' });
	const syncers: Array<() => void> = [];

	for (const seg of SEGMENTS) {
		const btn = pill.createEl('button', {
			cls: `wl-mode-pill-seg ${seg.cls}`,
			attr: { type: 'button', title: seg.title, 'aria-label': `Toggle ${seg.title.toLowerCase()}` },
		});
		const icon = btn.createSpan({ cls: 'wl-mode-pill-icon' });
		setIcon(icon, seg.icon);
		btn.createSpan({ cls: 'wl-mode-pill-label', text: seg.label });

		const sync = (): void => {
			const on = get()[seg.key];
			btn.toggleClass('is-active', on);
			btn.setAttr('aria-pressed', String(on));
		};
		sync();
		syncers.push(sync);

		btn.addEventListener('click', () => {
			set({ [seg.key]: !get()[seg.key] });
			for (const s of syncers) s();
		});
	}

	return pill;
}

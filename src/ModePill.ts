import { setIcon } from 'obsidian';
import { t } from './i18n';

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

const SEGMENTS: Array<{ key: keyof GameModes; cls: string; icon: string }> = [
	{ key: 'singleplayer', cls: 'wl-mode-pill-solo', icon: 'user' },
	{ key: 'coop', cls: 'wl-mode-pill-coop', icon: 'users' },
	{ key: 'multiplayer', cls: 'wl-mode-pill-multi', icon: 'globe' },
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
			attr: { type: 'button', title: t(`list.mode.${seg.key}.title`), 'aria-label': t(`list.mode.${seg.key}.toggle`) },
		});
		const icon = btn.createSpan({ cls: 'wl-mode-pill-icon' });
		setIcon(icon, seg.icon);
		btn.createSpan({ cls: 'wl-mode-pill-label', text: t(`list.mode.${seg.key}.label`) });

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

import { App, Modal, ToggleComponent, setIcon } from 'obsidian';
import type WatchLogPlugin from './main';
import { normalizeRowsLayout, type RowsShelfLayoutEntry } from './types';

/** Wires the modal to one tab's shelf registry + persisted layout, so any tab
 *  with a Rows view (Watchlist today, others later) can reuse it. */
export interface RowsCustomizeConfig {
	/** The tab's shelf registry — ids + display labels, in default order. */
	shelves: ReadonlyArray<{ id: string; label: string }>;
	/** Read the stored layout (may be stale/partial — normalized on open). */
	getLayout: () => RowsShelfLayoutEntry[] | undefined;
	/** Assign the (normalized) layout back to its settings slot. */
	setLayout: (layout: RowsShelfLayoutEntry[]) => void;
	/** Fired after every persisted change so an open Rows view can re-render
	 *  live behind the modal. */
	onChanged: () => void;
	hint?: string;
	/** Shelf ids that can't be enabled together (e.g. [['byType','byStatus']]).
	 *  Enabling one auto-disables the other members of its group. */
	exclusiveGroups?: ReadonlyArray<ReadonlyArray<string>>;
	/** Persist the layout's settings slot. Defaults to plugin.saveSettings()
	 *  (the Watchlist slot); tabs whose layout lives inside data.json (Games,
	 *  Reading) pass their own data-manager save here. */
	persist?: () => void;
}

/**
 * Customize panel for a Rows view's sections: reorder via up/down arrows (more reliable on touch
 * than drag) and toggle each on/off — horizontal shelves and virtualised grids alike, so any section
 * can sit anywhere or be hidden. Every change is persisted immediately and `onChanged` fires, so an
 * open Rows view re-renders live behind the modal.
 */
export class RowsCustomizeModal extends Modal {
	private plugin: WatchLogPlugin;
	private config: RowsCustomizeConfig;
	private layout: RowsShelfLayoutEntry[] = [];
	private listEl: HTMLElement | null = null;

	constructor(app: App, plugin: WatchLogPlugin, config: RowsCustomizeConfig) {
		super(app);
		this.plugin = plugin;
		this.config = config;
	}

	onOpen(): void {
		const colorTheme = this.plugin.settings.colorTheme ?? 'default';
		this.modalEl.setAttribute('data-theme', colorTheme);
		this.contentEl.setAttribute('data-theme', colorTheme);
		this.contentEl.addClass('wl-view');
		this.contentEl.addClass('wl-rows-customize');
		this.titleEl.setText('Customize rows');

		// normalize once up-front so the indices the arrow buttons swap match what gets persisted
		this.layout = normalizeRowsLayout(this.config.getLayout(), this.config.shelves, this.config.exclusiveGroups);
		this.config.setLayout(this.layout);

		this.contentEl.createDiv({
			cls: 'wl-rows-customize-hint',
			text: this.config.hint ?? 'Reorder the sections or switch them off.',
		});
		this.listEl = this.contentEl.createDiv({ cls: 'wl-rows-customize-list' });
		this.renderList();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private labelFor(id: string): string {
		return this.config.shelves.find((s) => s.id === id)?.label ?? id;
	}

	/** Persist the current layout and refresh an open Rows view live. */
	private persist(): void {
		if (this.config.persist) this.config.persist();
		else void this.plugin.saveSettings();
		this.config.onChanged();
	}

	/** Reorders also rebuild the list (row order + arrow disabled states). */
	private apply(): void {
		this.persist();
		this.renderList();
	}

	private renderList(): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();
		const layout = this.layout;

		layout.forEach((entry, i) => {
			const row = list.createDiv({ cls: 'wl-rows-customize-row' });
			row.createSpan({ cls: 'wl-rows-customize-name', text: this.labelFor(entry.id) });
			const controls = row.createDiv({ cls: 'wl-rows-customize-controls' });

			const upBtn = controls.createEl('button', { cls: 'wl-rows-customize-move' });
			setIcon(upBtn, 'chevron-up');
			upBtn.setAttr('aria-label', 'Move up');
			upBtn.disabled = i === 0;
			upBtn.addEventListener('click', () => {
				const prev = layout[i - 1];
				if (!prev) return;
				layout[i - 1] = entry;
				layout[i] = prev;
				this.apply();
			});

			const downBtn = controls.createEl('button', { cls: 'wl-rows-customize-move' });
			setIcon(downBtn, 'chevron-down');
			downBtn.setAttr('aria-label', 'Move down');
			downBtn.disabled = i === layout.length - 1;
			downBtn.addEventListener('click', () => {
				const next = layout[i + 1];
				if (!next) return;
				layout[i + 1] = entry;
				layout[i] = next;
				this.apply();
			});

			new ToggleComponent(controls).setValue(entry.enabled).onChange((value) => {
				entry.enabled = value;
				// enabling a shelf in an exclusive group turns its siblings off; rebuild the list so their toggles
				// visibly flip
				if (value && this.config.exclusiveGroups) {
					let flipped = false;
					for (const group of this.config.exclusiveGroups) {
						if (!group.includes(entry.id)) continue;
						for (const other of layout) {
							if (other === entry || !group.includes(other.id) || !other.enabled) continue;
							other.enabled = false;
							flipped = true;
						}
					}
					if (flipped) {
						this.apply();
						return;
					}
				}
				this.persist();
			});
		});
	}
}

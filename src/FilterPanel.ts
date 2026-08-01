/**
 * The shared "Filters ▼" popover: collapsible sections of checkbox options with a ◆ All toggle,
 * optional boolean rows per section (✦ Recently arrived / Empty / ◇ Groups only), the ♥ Favorites
 * row, Select/Deselect all, a Save-or-Delete preset button, and draft + Apply semantics — the
 * caller's live filter state is never mutated until Apply. Used by ListTab and GamesTab.
 *
 * The caller owns the draft: section `excludeSet`s and the toggles' get/set closures all point into
 * a draft object built fresh on open; onApply commits it.
 */

/** A boolean toggle row rendered inside a section, under its ◆ All row. */
export interface FilterSpecialToggle {
	text: string;
	/** Class for the label span (e.g. wl-recently-arrived-filter). */
	spanCls?: string;
	get: () => boolean;
	set: (v: boolean) => void;
	/**
	 * 'exclusive' — checking it clears the section's excludes and re-checks its option boxes; touching
	 * any option row unchecks it (Recently arrived, Empty). 'independent' — a plain toggle.
	 */
	mode: 'exclusive' | 'independent';
	/** Reset (to false) by Select all / Deselect all — Recently arrived is, Empty and Groups only aren't. */
	resetOnGlobal?: boolean;
	/** Draw a section divider after this row (the Groups-only look). */
	dividerAfter?: boolean;
}

export interface FilterSection {
	label: string;
	opts: string[];
	/** Draft exclude set — mutated live by the checkboxes. */
	excludeSet: Set<string>;
	/** Display formatting for option labels (e.g. 4.5★ → 4½★). */
	formatOpt?: (opt: string) => string;
	specials?: FilterSpecialToggle[];
}

export interface FilterPanelConfig {
	/** The Filters button — the panel opens under it. */
	anchor: HTMLElement;
	/** Clicks inside this element (the button wrap) don't close the panel. */
	outsideGuard: HTMLElement;
	sections: FilterSection[];
	/** The ♥ Favorites row above the sections; reset by Select/Deselect all. */
	favorites?: { get: () => boolean; set: (v: boolean) => void };
	/** Further standalone boolean rows below Favorites (Games' 🎁 Wishlist), same behaviour. */
	standaloneRows?: Array<{
		text: string;
		spanCls?: string;
		get: () => boolean;
		set: (v: boolean) => void;
	}>;
	/** Whether a preset exists — decides the Save vs Delete button. */
	presetExists: boolean;
	onPresetSave: () => void | Promise<void>;
	onPresetDelete: () => void | Promise<void>;
	/** Called after save/delete completed (the panel is already removed). */
	onPresetChanged: () => void;
	/** Commit the draft to live state and re-render; panel closes itself. */
	onApply: () => void;
	/**
	 * Hands the caller a teardown to run on re-render / view close (the tab's `activeCleanups`
	 * array). The panel lives in document.body, so without it a popover left open when its tab goes
	 * away outlives the tab along with its document-level mousedown listener.
	 */
	registerCleanup?: (fn: () => void) => void;
}

/** Opens the panel under the anchor, or closes an already-open one (toggle). */
export function toggleFilterPanel(cfg: FilterPanelConfig): void {
	const existing = activeDocument.querySelector('.wl-filters-panel');
	if (existing) { existing.remove(); return; }

	const panel = activeDocument.body.createDiv({ cls: 'wl-dropdown wl-filters-panel wl-filters-panel-popup' });
	const rect = cfg.anchor.getBoundingClientRect();
	panel.style.top = `${rect.bottom + 4}px`;
	panel.style.left = `${rect.left}px`;

	// single teardown for every close path (Apply, outside click, preset save/delete, tab teardown);
	// `closed` makes it idempotent and guards the deferred listener attach at the end
	let closed = false;
	const closePanel = (): void => {
		if (closed) return;
		closed = true;
		panel.remove();
		activeDocument.removeEventListener('mousedown', closer, false);
	};

	const allCheckboxRefs: Array<{ cb: HTMLInputElement }> = [];
	// specials that Select all / Deselect all reset, plus the favorites row
	const globalResetRefs: Array<{ cb: HTMLInputElement; set: (v: boolean) => void }> = [];

	const resetGlobals = (): void => {
		for (const ref of globalResetRefs) {
			ref.set(false);
			ref.cb.checked = false;
		}
	};

	const globalRow = panel.createDiv({ cls: 'wl-filter-global-btns' });

	const selectAllBtn = globalRow.createEl('button', { cls: 'wl-btn wl-btn-sm', text: 'Select all' });
	selectAllBtn.addEventListener('click', (ev) => {
		ev.stopPropagation();
		for (const { excludeSet } of cfg.sections) excludeSet.clear();
		for (const { cb } of allCheckboxRefs) cb.checked = true;
		resetGlobals();
	});
	const deselectAllBtn = globalRow.createEl('button', { cls: 'wl-btn wl-btn-sm', text: 'Deselect all' });
	deselectAllBtn.addEventListener('click', (ev) => {
		ev.stopPropagation();
		for (const { opts, excludeSet } of cfg.sections) {
			for (const opt of opts) excludeSet.add(opt);
		}
		for (const { cb } of allCheckboxRefs) cb.checked = false;
		resetGlobals();
	});

	// Save / Delete preset button
	const saveDeleteBtn = globalRow.createEl('button', {
		cls: 'wl-btn wl-btn-sm',
		text: cfg.presetExists ? 'Delete' : 'Save',
	});
	saveDeleteBtn.addEventListener('click', (ev) => {
		void (async () => {
			ev.stopPropagation();
			if (saveDeleteBtn.textContent === 'Save') {
				await cfg.onPresetSave();
			} else {
				await cfg.onPresetDelete();
			}
			closePanel();
			cfg.onPresetChanged();
		})();
	});

	// favorites-only toggle — standalone row above the sections
	if (cfg.favorites) {
		const fav = cfg.favorites;
		const favRow = panel.createDiv({ cls: 'wl-filter-checkbox-row wl-filter-favorites-row' });
		const favCb = favRow.createEl('input', { attr: { type: 'checkbox' } });
		favCb.checked = fav.get();
		favRow.createSpan({ cls: 'wl-favorites-filter', text: '♥ Favorites' });
		favCb.addEventListener('change', () => { fav.set(favCb.checked); });
		globalResetRefs.push({ cb: favCb, set: fav.set });
	}

	for (const row of cfg.standaloneRows ?? []) {
		const rowEl = panel.createDiv({ cls: 'wl-filter-checkbox-row wl-filter-favorites-row' });
		const cb = rowEl.createEl('input', { attr: { type: 'checkbox' } });
		cb.checked = row.get();
		rowEl.createSpan(row.spanCls ? { cls: row.spanCls, text: row.text } : { text: row.text });
		cb.addEventListener('change', () => { row.set(cb.checked); });
		globalResetRefs.push({ cb, set: row.set });
	}

	// collapsed by default
	const sectionCollapsed: Record<string, boolean> = {};
	for (const { label } of cfg.sections) {
		sectionCollapsed[label] = true;
	}

	for (const { label, opts, excludeSet, formatOpt, specials } of cfg.sections) {
		const section = panel.createDiv({ cls: 'wl-filter-section' });

		const sectionHeader = section.createDiv({ cls: 'wl-filter-section-header' });
		sectionHeader.createSpan({ cls: 'wl-filter-label', text: label });
		const chevron = sectionHeader.createSpan({ cls: 'wl-filter-chevron', text: '▼' });

		const content = section.createDiv({ cls: 'wl-filter-section-content wl-hidden' });

		sectionHeader.addEventListener('click', (ev) => {
			ev.stopPropagation();
			sectionCollapsed[label] = !sectionCollapsed[label];
			const collapsed = sectionCollapsed[label] ?? true;
			content.toggleClass('wl-hidden', collapsed);
			chevron.textContent = collapsed ? '▼' : '▲';
		});

		// "All" toggle — first item inside the section
		const allRow = content.createDiv({ cls: 'wl-filter-checkbox-row' });
		const allCb = allRow.createEl('input', { attr: { type: 'checkbox' } });
		allRow.createSpan({ cls: 'wl-filter-all-toggle', text: '◆ All' });

		const optionCbs: HTMLInputElement[] = [];
		// exclusive specials in this section — unchecked when an option is touched
		const exclusiveRefs: Array<{ cb: HTMLInputElement; set: (v: boolean) => void }> = [];

		for (const special of specials ?? []) {
			const row = content.createDiv({ cls: 'wl-filter-checkbox-row' });
			const cb = row.createEl('input', { attr: { type: 'checkbox' } });
			cb.checked = special.get();
			row.createSpan(special.spanCls ? { cls: special.spanCls, text: special.text } : { text: special.text });

			cb.addEventListener('change', () => {
				special.set(cb.checked);
				if (special.mode === 'exclusive' && cb.checked) {
					// exclusive toggles supersede the option list — reset it
					excludeSet.clear();
					for (const optCb of optionCbs) optCb.checked = true;
				}
			});

			if (special.mode === 'exclusive') exclusiveRefs.push({ cb, set: special.set });
			if (special.resetOnGlobal) globalResetRefs.push({ cb, set: special.set });
			if (special.dividerAfter) content.createDiv({ cls: 'wl-filter-section-divider' });
		}

		for (const opt of opts) {
			const cbRow = content.createDiv({ cls: 'wl-filter-checkbox-row' });
			const cb = cbRow.createEl('input', { attr: { type: 'checkbox' } });
			cb.checked = !excludeSet.has(opt);
			cbRow.createSpan({ text: formatOpt ? formatOpt(opt) : opt });
			optionCbs.push(cb);
			allCheckboxRefs.push({ cb });

			cb.addEventListener('change', () => {
				if (cb.checked) excludeSet.delete(opt);
				else excludeSet.add(opt);
				// interacting with a specific option deactivates the section's exclusive toggles
				for (const ref of exclusiveRefs) {
					ref.set(false);
					ref.cb.checked = false;
				}
			});
		}

		// reflect the current state in the "All" checkbox
		const syncAllCb = (): void => {
			allCb.checked = optionCbs.length > 0 && optionCbs.every((c) => c.checked);
		};
		syncAllCb();

		const toggleAll = (): void => {
			const allChecked = optionCbs.length > 0 && optionCbs.every((c) => c.checked);
			if (allChecked) {
				for (const optCb of optionCbs) optCb.checked = false;
				for (const opt of opts) excludeSet.add(opt);
			} else {
				for (const optCb of optionCbs) optCb.checked = true;
				excludeSet.clear();
			}
			syncAllCb();
		};
		allCb.addEventListener('click', (ev) => {
			ev.stopPropagation();
			// we drive the visual + data state ourselves; cancel the native toggle
			toggleAll();
		});
		allRow.addEventListener('click', (ev) => {
			if (ev.target === allCb) return;
			ev.stopPropagation();
			toggleAll();
		});
	}

	// Apply — commits the draft, re-renders, closes the panel
	const applyBtn = panel.createEl('button', { cls: 'wl-btn wl-btn-sm wl-filter-apply-btn', text: 'Apply' });
	applyBtn.addEventListener('click', (ev) => {
		ev.stopPropagation();
		cfg.onApply();
		closePanel();
	});

	const closer = (ev: MouseEvent): void => {
		const target = ev.target as Node;
		if (panel.contains(target) || cfg.outsideGuard.contains(target)) return;
		closePanel();
	};
	// deferred so the click that opened the panel doesn't immediately close it
	window.setTimeout(() => {
		if (!closed) activeDocument.addEventListener('mousedown', closer, false);
	}, 0);
	cfg.registerCleanup?.(closePanel);
}

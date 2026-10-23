import { toggleFilterPanel, type FilterPanelConfig, type FilterSection } from '../FilterPanel';
import { formatPriorityOpt, priorityFilterOpts, type TagDefinition } from '../types';

/**
 * Rating filter options 1★ … 5★; a half option (½★ … 4½★) appears only when an item holds that
 * exact rating. Keys mirror the `${rating}★` filter keys, so 4.5 matches "4.5★", never 4 or 5.
 */
export function buildRatingOpts(ratings: Iterable<number>): string[] {
	const presentHalf = new Set<number>();
	for (const r of ratings) {
		if (r % 1 === 0.5) presentHalf.add(r);
	}
	const opts: string[] = [];
	for (let i = 1; i <= 5; i++) {
		if (presentHalf.has(i - 0.5)) opts.push(`${i - 0.5}★`);
		opts.push(`${i}★`);
	}
	return opts;
}

/** Display form of a rating option: 4.5★ → 4½★, 0.5★ → ½★. */
export function formatRatingOpt(opt: string): string {
	return opt.replace(/^(\d+)\.5/, (_m, whole: string) => (whole === '0' ? '½' : `${whole}½`));
}

/** The draft fields both tabs' filter panels share. */
export interface CommonFilterDraft {
	statusExclude: Set<string>;
	ratingExclude: Set<string>;
	priorityExclude: Set<string>;
	groupExclude: Set<string>;
	filterRatingEmptyOnly: boolean;
	filterRecentlyArrivedOnly: boolean;
	filterGroupsOnly: boolean;
}

export interface FilterSectionsInput {
	/** Leading section(s): Genre/Type. */
	lead: FilterSection[];
	statusOpts: string[];
	ratingOpts: string[];
	priorities: TagDefinition[];
	/** Sections between Priority and Group (Games' Platform). */
	middle?: FilterSection[];
	groupOpts: string[];
	draft: CommonFilterDraft;
}

/** Lead, Status (+ Recently arrived), Rating (+ Empty), Priority, middle, Group (+ Groups only; only with groups). */
export function buildFilterSections(input: FilterSectionsInput): FilterSection[] {
	const { draft } = input;
	const sections: FilterSection[] = [
		...input.lead,
		{
			label: 'Status', opts: input.statusOpts, excludeSet: draft.statusExclude,
			specials: [{
				text: '✦ Recently arrived',
				spanCls: 'wl-recently-arrived-filter',
				get: () => draft.filterRecentlyArrivedOnly,
				set: (v) => { draft.filterRecentlyArrivedOnly = v; },
				mode: 'exclusive',
				resetOnGlobal: true,
			}],
		},
		{
			label: 'Rating', opts: input.ratingOpts, excludeSet: draft.ratingExclude,
			formatOpt: formatRatingOpt,
			specials: [{
				text: 'Empty',
				get: () => draft.filterRatingEmptyOnly,
				set: (v) => { draft.filterRatingEmptyOnly = v; },
				mode: 'exclusive',
			}],
		},
		{
			label: 'Priority', opts: priorityFilterOpts(input.priorities), excludeSet: draft.priorityExclude,
			formatOpt: formatPriorityOpt,
		},
		...(input.middle ?? []),
	];
	if (input.groupOpts.length > 0) {
		sections.push({
			label: 'Group', opts: input.groupOpts, excludeSet: draft.groupExclude,
			specials: [{
				text: '◇ Groups only',
				spanCls: 'wl-recently-arrived-filter',
				get: () => draft.filterGroupsOnly,
				set: (v) => { draft.filterGroupsOnly = v; },
				mode: 'independent',
				dividerAfter: true,
			}],
		});
	}
	return sections;
}

/** What a tab builds each time the panel opens: its draft and everything that reads it. */
export interface FilterDraftPanel {
	sections: FilterSection[];
	favorites: NonNullable<FilterPanelConfig['favorites']>;
	standaloneRows?: FilterPanelConfig['standaloneRows'];
	/** Persists the draft as the saved preset. */
	savePreset: () => Promise<void>;
	/** Copies the draft into the tab's live filter state. */
	commit: () => void;
}

export interface FiltersDropdownOptions {
	hasActiveFilter: () => boolean;
	clearAll: () => void;
	/** Re-renders the tab content after a clear/apply. */
	rerender: () => void;
	/** Persists the live filters and drops the saved-preset highlight. */
	persist: () => void;
	/** Re-renders the whole tab after the saved preset changed. */
	rerenderAll: () => void;
	registerCleanup: (fn: () => void) => void;
	preset: {
		exists: () => boolean;
		/** Deletes the stored preset and drops the tab's "active" flag. */
		remove: () => Promise<void>;
	};
	/** Builds the draft; called on every click of the Filters button. */
	openDraft: () => FilterDraftPanel;
}

/** "Filters ▼" button with its active dot, the "✕ clear" button next to it, and the panel wiring. */
export function renderFiltersDropdown(parent: HTMLElement, opts: FiltersDropdownOptions): void {
	const wrap = parent.createDiv({ cls: 'wl-add-btn-wrap' });
	const btn = wrap.createEl('button', { cls: 'wl-btn wl-btn-sm', text: 'Filters ▼' });
	const dotEl = btn.createSpan({ cls: 'wl-filter-dot' });
	const clearBtn = parent.createEl('button', { cls: 'wl-btn wl-btn-sm wl-btn-clear-filters', text: '✕ clear' });
	clearBtn.title = 'Clear all filters';
	const syncIndicators = (): void => {
		if (opts.hasActiveFilter()) { dotEl.show(); clearBtn.show(); } else { dotEl.hide(); clearBtn.hide(); }
	};
	syncIndicators();
	clearBtn.addEventListener('click', () => {
		opts.clearAll();
		opts.persist();
		dotEl.hide();
		clearBtn.hide();
		opts.rerender();
	});
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		const draft = opts.openDraft();
		toggleFilterPanel({
			anchor: btn,
			outsideGuard: wrap,
			registerCleanup: opts.registerCleanup,
			sections: draft.sections,
			favorites: draft.favorites,
			standaloneRows: draft.standaloneRows,
			presetExists: opts.preset.exists(),
			onPresetSave: draft.savePreset,
			onPresetDelete: opts.preset.remove,
			onPresetChanged: opts.rerenderAll,
			onApply: () => {
				draft.commit();
				opts.persist();
				syncIndicators();
				opts.rerender();
			},
		});
	});
}

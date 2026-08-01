import { App, Modal } from 'obsidian';
import type WatchLogPlugin from './main';
import type { WatchLogTitle, CreditsField } from './types';
import { getDisplayCredits, getManualCredits, getTitleCredits } from './types';

/** A name offered by the search pane, with how often it appears in each field library-wide. */
interface CreditSuggestion {
	name: string;
	directorCount: number;
	castCount: number;
}

const MAX_SUGGESTIONS = 12;

/**
 * Adds missing directors / cast to a title by hand — the `+` on either credits row opens this.
 *
 * The left pane searches every name already known to the Watchlist (both fields, matching-field
 * entries first) and offers an "Add <typed name>" row when nothing matches, so finding an existing
 * name and inventing a new one are the same control. Picking a name stages it on the right and
 * clears the input, which makes a run of several additions one continuous flow — nothing is written
 * until "Add all".
 *
 * The staged list starts with the title's current manual entries, so the same modal removes them:
 * the commit replaces the whole manual array. Fetched credits are never touched here.
 */
export class AddCreditModal extends Modal {
	private plugin: WatchLogPlugin;
	private title: WatchLogTitle;
	private field: CreditsField;
	private onSaved: () => void;

	/** Names already committed as manual — the baseline the save button diffs against. */
	private readonly initial: string[];
	private staged: string[];

	private query = '';
	private focusedIdx = -1;

	private searchInput: HTMLInputElement | null = null;
	private resultsEl: HTMLElement | null = null;
	private stagedEl: HTMLElement | null = null;
	private saveBtn: HTMLButtonElement | null = null;

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		title: WatchLogTitle,
		field: CreditsField,
		onSaved: () => void,
	) {
		super(app);
		this.plugin = plugin;
		this.title = title;
		this.field = field;
		this.onSaved = onSaved;
		this.initial = [...getManualCredits(title, field)];
		this.staged = [...this.initial];
	}

	private get label(): string {
		return this.field === 'director' ? 'director' : 'cast';
	}

	onOpen(): void {
		const colorTheme = this.plugin.settings.colorTheme ?? 'default';
		this.modalEl.setAttribute('data-theme', colorTheme);
		this.contentEl.setAttribute('data-theme', colorTheme);
		this.titleEl.setText(`Add ${this.label}`);
		this.contentEl.addClass('wl-view');
		this.contentEl.addClass('wl-credit-modal');
		this.renderBody();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// Suggestion pool
	/**
	 * Every distinct credit name across the Watchlist, counted per field. Built from the merged view,
	 * so names another title only has manually still turn up — type a name once and it's reusable.
	 */
	private buildPool(): CreditSuggestion[] {
		const pool = new Map<string, CreditSuggestion>();
		const add = (name: string, field: CreditsField): void => {
			const key = name.toLowerCase();
			const entry = pool.get(key) ?? { name, directorCount: 0, castCount: 0 };
			if (field === 'director') entry.directorCount++;
			else entry.castCount++;
			pool.set(key, entry);
		};
		for (const t of this.plugin.dataManager.getTitles()) {
			for (const name of getTitleCredits(t, 'director')) add(name, 'director');
			for (const name of getTitleCredits(t, 'cast')) add(name, 'cast');
		}
		return [...pool.values()];
	}

	/** Count line under a suggestion: the field being edited first, the other one after. */
	private metaFor(s: CreditSuggestion): string {
		const parts: string[] = [];
		const push = (n: number, word: string): void => {
			if (n > 0) parts.push(`${word} in ${n} title${n === 1 ? '' : 's'}`);
		};
		if (this.field === 'director') {
			push(s.directorCount, 'Director');
			push(s.castCount, 'Cast');
		} else {
			push(s.castCount, 'Cast');
			push(s.directorCount, 'Director');
		}
		return parts.join(' · ');
	}

	/** Names already on the title — fetched ones can't be staged, staged ones can't be re-added. */
	private isPresent(name: string): boolean {
		const key = name.toLowerCase();
		const fetched = getDisplayCredits(
			this.field === 'director' ? this.title.director : this.title.cast,
		);
		return (
			fetched.some((n) => n.toLowerCase() === key) ||
			this.staged.some((n) => n.toLowerCase() === key)
		);
	}

	// Layout
	private renderBody(): void {
		const content = this.contentEl;
		content.empty();

		content.createDiv({
			cls: 'wl-modal-info',
			text: `Search names already in your library, or type a new one. Added names sit after the fetched ${this.label} and survive a refresh.`,
		});

		const panes = content.createDiv({ cls: 'wl-credit-panes' });

		// left — search + results
		const searchPane = panes.createDiv({ cls: 'wl-credit-pane wl-credit-search-pane' });
		this.searchInput = searchPane.createEl('input', {
			cls: 'wl-modal-input wl-credit-search-input',
			attr: { type: 'text', placeholder: `Search or add a ${this.label} name...` },
		});
		this.searchInput.value = this.query;
		this.searchInput.addEventListener('input', () => {
			this.query = this.searchInput?.value ?? '';
			this.focusedIdx = -1;
			this.renderResults();
		});
		this.searchInput.addEventListener('keydown', (e) => this.onSearchKeydown(e));
		this.resultsEl = searchPane.createDiv({ cls: 'wl-credit-results' });

		// right — staged names
		const stagedPane = panes.createDiv({ cls: 'wl-credit-pane wl-credit-staged-pane' });
		stagedPane.createDiv({ cls: 'wl-credit-pane-title', text: 'To add' });
		this.stagedEl = stagedPane.createDiv({ cls: 'wl-credit-staged' });

		const btnRow = content.createDiv({ cls: 'wl-modal-btn-row' });
		const cancelBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-mr', text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());
		this.saveBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Add all' });
		this.saveBtn.addEventListener('click', () => void this.commit());

		this.renderResults();
		this.renderStaged();
		this.searchInput.focus();
	}

	// Results pane
	private renderResults(): void {
		const list = this.resultsEl;
		if (!list) return;
		list.empty();

		const q = this.query.trim();
		if (!q) {
			list.createDiv({
				cls: 'wl-credit-hint',
				text: 'Start typing to search names from your other titles.',
			});
			return;
		}

		const lower = q.toLowerCase();
		const matches = this.buildPool()
			.filter((s) => s.name.toLowerCase().includes(lower))
			.sort((a, b) => {
				// matching-field entries first, then by how widely the name is used
				const rank = (s: CreditSuggestion): number =>
					this.field === 'director' ? s.directorCount : s.castCount;
				const present = (s: CreditSuggestion): number => (this.isPresent(s.name) ? 1 : 0);
				return (
					present(a) - present(b) ||
					rank(b) - rank(a) ||
					b.directorCount + b.castCount - (a.directorCount + a.castCount) ||
					a.name.localeCompare(b.name)
				);
			})
			.slice(0, MAX_SUGGESTIONS);

		// "Add <typed>" leads unless an existing name matches the query exactly
		const exact = matches.some((s) => s.name.toLowerCase() === lower);
		if (!exact) {
			this.renderResultRow(list, q, `New ${this.label} name`, true);
		}
		for (const s of matches) {
			this.renderResultRow(list, s.name, this.metaFor(s), false);
		}
		if (exact && matches.length === 0) {
			list.createDiv({ cls: 'wl-credit-hint', text: 'No matches.' });
		}
	}

	private renderResultRow(
		list: HTMLElement,
		name: string,
		meta: string,
		isNew: boolean,
	): void {
		const present = this.isPresent(name);
		const item = list.createDiv({ cls: 'wl-result-item wl-credit-result' });
		if (isNew) item.addClass('wl-credit-result-new');
		item.createDiv({ cls: 'wl-result-title', text: isNew ? `Add "${name}"` : name });
		item.createDiv({ cls: 'wl-result-meta', text: present ? 'Already on this title' : meta });
		if (present) {
			item.addClass('is-disabled');
			return;
		}
		item.dataset.creditName = name;
		item.addEventListener('mousedown', (e) => {
			// staging must not blur the input — the run continues in the same field
			e.preventDefault();
			this.stage(name);
		});
	}

	/** Result rows that can actually be staged, in render order — the keyboard target set. */
	private selectableItems(): HTMLElement[] {
		if (!this.resultsEl) return [];
		return Array.from(
			this.resultsEl.querySelectorAll<HTMLElement>('.wl-credit-result:not(.is-disabled)'),
		);
	}

	private onSearchKeydown(e: KeyboardEvent): void {
		const items = this.selectableItems();
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (items.length === 0) return;
			e.preventDefault();
			this.focusedIdx =
				e.key === 'ArrowDown'
					? Math.min(this.focusedIdx + 1, items.length - 1)
					: Math.max(this.focusedIdx - 1, 0);
			items.forEach((item, i) =>
				item.toggleClass('wl-result-item-focused', i === this.focusedIdx),
			);
			items[this.focusedIdx]?.scrollIntoView({ block: 'nearest' });
			return;
		}
		if (e.key === 'Enter') {
			// no explicit selection stages the top row, so a name can be added with type-then-Enter
			const target = items[this.focusedIdx >= 0 ? this.focusedIdx : 0];
			const name = target?.dataset.creditName;
			if (!name) return;
			e.preventDefault();
			this.stage(name);
		}
	}

	// Staged pane
	private stage(name: string): void {
		if (this.isPresent(name)) return;
		this.staged.push(name);
		this.query = '';
		this.focusedIdx = -1;
		if (this.searchInput) {
			this.searchInput.value = '';
			this.searchInput.focus();
		}
		this.renderResults();
		this.renderStaged();
	}

	private renderStaged(): void {
		const wrap = this.stagedEl;
		if (!wrap) return;
		wrap.empty();

		if (this.staged.length === 0) {
			wrap.createDiv({ cls: 'wl-credit-hint', text: 'Nothing staged yet.' });
			this.updateSaveState();
			return;
		}

		this.staged.forEach((name, idx) => {
			const chip = wrap.createDiv({ cls: 'wl-credit-chip' });
			chip.createSpan({ cls: 'wl-credit-chip-name', text: name });
			const del = chip.createEl('button', { cls: 'wl-credit-chip-del', text: '✕' });
			del.title = `Remove ${name}`;
			del.setAttr('aria-label', `Remove ${name}`);
			del.addEventListener('click', () => {
				this.staged.splice(idx, 1);
				this.renderResults();
				this.renderStaged();
			});
		});
		this.updateSaveState();
	}

	/**
	 * The button reads as whatever the commit will do: additions when there are any, otherwise a plain
	 * save for a run that only removed names.
	 */
	private updateSaveState(): void {
		if (!this.saveBtn) return;
		const initialKeys = new Set(this.initial.map((n) => n.toLowerCase()));
		const added = this.staged.filter((n) => !initialKeys.has(n.toLowerCase())).length;
		const removed = this.initial.length - (this.staged.length - added);
		this.saveBtn.textContent = added > 0 ? `Add all (${added})` : 'Save changes';
		this.saveBtn.disabled = added === 0 && removed === 0;
	}

	private async commit(): Promise<void> {
		await this.plugin.dataManager.updateManualCredits(this.title.id, this.field, this.staged);
		this.onSaved();
		this.close();
	}
}

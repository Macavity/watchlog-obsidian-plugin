import { apiErrorMessage } from '../ApiService';

export interface SearchPickerConfig<R> {
	/** Placeholder of the query input. */
	placeholder: string;
	/** Runs the API search; throws on API errors (shown in the results panel). */
	search: (query: string, year: string) => Promise<R[]>;
	/** Text for the "no API" panel, or null when the API is available. Checked per search. */
	noApiMessage: () => string | null;
	/**
	 * Renders one result card into host and returns its element. Call select(itemEl) from the
	 * card's click handler.
	 */
	renderResult: (host: HTMLElement, result: R, select: (itemEl: HTMLElement) => void) => HTMLElement;
	/**
	 * Called after the card is highlighted. isCurrent() turns false once a newer search or
	 * selection started, so async work can drop stale responses.
	 */
	onSelect: (result: R, isCurrent: () => boolean) => void | Promise<void>;
	/** Adds the year input and the stacked search-row layout. */
	withYear?: boolean;
	/** Adds the results grid class. */
	grid?: boolean;
	/** Results per page; without it all results render and there is no pager. */
	pageSize?: number;
	initialQuery?: string;
	/** Default 600. */
	debounceMs?: number;
}

export interface SearchPicker {
	/** Appends the search row, results panel and pager to parent. */
	mount(parent: HTMLElement): void;
	/** Runs a search with the current query (no-op when empty). */
	search(): Promise<void>;
	/** Clears results and error/no-API state, e.g. after a type change. */
	reset(): void;
	/** Cancels the pending debounce; call from onClose. */
	destroy(): void;
}

export function createSearchPicker<R>(config: SearchPickerConfig<R>): SearchPicker {
	const debounceMs = config.debounceMs ?? 600;
	let query = config.initialQuery ?? '';
	let year = '';
	let results: R[] = [];
	let page = 0;
	let isSearching = false;
	let generation = 0;
	let noApi = '';
	let error = '';
	let resultsEl: HTMLElement | null = null;
	let pagerEl: HTMLElement | null = null;
	let debounce: number | null = null;

	const pageCount = (): number =>
		config.pageSize ? Math.ceil(results.length / config.pageSize) : 0;

	function scheduleSearch(): void {
		if (debounce) window.clearTimeout(debounce);
		debounce = window.setTimeout(() => void search(), debounceMs);
	}

	function mountSearchRow(parent: HTMLElement): void {
		const withYear = config.withYear ?? false;
		const row = parent.createDiv({ cls: withYear ? 'wl-modal-row wl-search-row' : 'wl-modal-row' });
		row.createSpan({ cls: 'wl-modal-label', text: 'Search' });
		// one wrapper so mobile can stack: query on top, year + button under it
		const fields = withYear ? row.createDiv({ cls: 'wl-search-fields' }) : row;
		const queryInput = fields.createEl('input', {
			cls: withYear ? 'wl-modal-input wl-search-query' : 'wl-modal-input',
			attr: { type: 'text', placeholder: config.placeholder },
		});
		queryInput.value = query;
		queryInput.addEventListener('input', () => {
			query = queryInput.value;
			scheduleSearch();
		});
		if (withYear) {
			const yearInput = fields.createEl('input', {
				cls: 'wl-modal-input wl-search-year',
				attr: { type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'Year' },
			});
			yearInput.value = year;
			yearInput.addEventListener('input', () => {
				// digits only; the APIs want a bare YYYY
				yearInput.value = yearInput.value.replace(/\D/g, '');
				year = yearInput.value;
				scheduleSearch();
			});
		}
		const searchBtn = fields.createEl('button', { cls: 'wl-btn', text: 'Search' });
		searchBtn.addEventListener('click', () => void search());
	}

	function mount(parent: HTMLElement): void {
		mountSearchRow(parent);
		resultsEl = parent.createDiv({
			cls: config.grid ? 'wl-modal-results wl-results-grid' : 'wl-modal-results',
		});
		if (config.pageSize) pagerEl = parent.createDiv({ cls: 'wl-result-pager' });
	}

	async function search(): Promise<void> {
		if (!query.trim()) return;
		const gen = ++generation;
		isSearching = true;
		page = 0;
		renderResults();
		try {
			const unavailable = config.noApiMessage();
			const found = unavailable === null ? await config.search(query, year) : [];
			if (gen !== generation) return; // stale
			noApi = unavailable ?? '';
			error = '';
			results = found;
		} catch (err) {
			if (gen !== generation) return;
			// in the panel, not a Notice: a blank result list is what made a rejected key
			// look like a title that does not exist
			error = apiErrorMessage(err);
			results = [];
		} finally {
			if (gen === generation) {
				isSearching = false;
				renderResults();
			}
		}
	}

	function renderMessage(host: HTMLElement, icon: string, text: string, extraCls = ''): void {
		const msg = host.createDiv({ cls: `wl-modal-no-api${extraCls}` });
		msg.createSpan({ cls: 'wl-modal-no-api-icon', text: icon });
		msg.createSpan({ cls: 'wl-modal-no-api-text', text });
	}

	function select(result: R, itemEl: HTMLElement): void {
		if (resultsEl) {
			for (const child of Array.from(resultsEl.children)) child.removeClass('is-selected');
		}
		itemEl.addClass('is-selected');
		const gen = ++generation;
		void config.onSelect(result, () => gen === generation);
	}

	function renderResults(): void {
		if (!resultsEl) return;
		const host = resultsEl;
		host.empty();
		renderPager();
		if (isSearching) {
			host.createDiv({ cls: 'wl-modal-loading', text: 'Searching...' });
			return;
		}
		if (noApi) return renderMessage(host, 'ℹ', noApi);
		if (error) return renderMessage(host, '⚠', error, ' wl-modal-api-error');
		const start = config.pageSize ? page * config.pageSize : 0;
		const visible = config.pageSize ? results.slice(start, start + config.pageSize) : results;
		visible.forEach((result, i) => {
			const item = config.renderResult(host, result, (itemEl) => select(result, itemEl));
			item.dataset['idx'] = String(start + i);
		});
	}

	function renderPager(): void {
		if (!pagerEl) return;
		pagerEl.empty();
		const total = pageCount();
		if (isSearching || total <= 1) return;

		const prev = pagerEl.createEl('button', { cls: 'wl-btn wl-result-pager-btn', text: '‹' });
		prev.disabled = page === 0;
		prev.addEventListener('click', () => goToPage(page - 1));

		pagerEl.createSpan({ cls: 'wl-result-pager-info', text: `Page ${page + 1} of ${total}` });

		const next = pagerEl.createEl('button', { cls: 'wl-btn wl-result-pager-btn', text: '›' });
		next.disabled = page >= total - 1;
		next.addEventListener('click', () => goToPage(page + 1));
	}

	function goToPage(target: number): void {
		page = Math.max(0, Math.min(target, pageCount() - 1));
		renderResults();
		resultsEl?.scrollTo({ top: 0 });
	}

	return {
		mount,
		search,
		reset(): void {
			results = [];
			noApi = '';
			error = '';
			renderResults();
		},
		destroy(): void {
			if (debounce) window.clearTimeout(debounce);
		},
	};
}

import { App, Modal, Notice } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { MaybeTitle, AnimeSearchResult, MediaSearchResult } from './types';
import { formatDateDisplay, getApiGroupForType } from './types';
import {
	renderMediaFields,
	resetForm,
	type MediaFields,
} from './ui/FormCells';
import { apiErrorMessage, SEARCH_PAGE_SIZE, SEARCH_RESULT_LIMIT } from './ApiService';

type SearchResult = AnimeSearchResult | MediaSearchResult;

function isAnimeResult(r: SearchResult): r is AnimeSearchResult {
	return 'malId' in r;
}

export class MaybeAddModal extends Modal {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private onAdded: () => void;

	private selectedType = 'Anime';
	private searchQuery = '';
	private searchYear = '';
	private searchResults: SearchResult[] = [];
	private resultPage = 0;
	private isSearching = false;
	private searchGeneration = 0;
	private searchError = '';


	private resultsEl: HTMLElement | null = null;
	private pagerEl: HTMLElement | null = null;
	private media: MediaFields = { title: '', episodes: 0, duration: 0, releaseDate: '', link: '' };
	private formEl: HTMLElement | null = null;
	private searchDebounce: number | null = null;

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		dataManager: DataManager,
		onAdded: () => void,
	) {
		super(app);
		this.plugin = plugin;
		this.dataManager = dataManager;
		this.onAdded = onAdded;
	}

	onOpen(): void {
		this.titleEl.setText('Add to maybe');
		this.contentEl.addClass('wl-add-modal');
		this.buildUI();
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
	}

	private buildUI(): void {
		const content = this.contentEl;
		content.empty();

		const typeRow = content.createDiv({ cls: 'wl-modal-row' });
		typeRow.createSpan({ cls: 'wl-modal-label', text: 'Type' });
		const typeSelect = typeRow.createEl('select', { cls: 'wl-select' });
		for (const t of this.plugin.settings.types) {
			const opt = typeSelect.createEl('option', { text: t.name, value: t.name });
			if (t.name === this.selectedType) opt.selected = true;
		}
		typeSelect.addEventListener('change', () => {
			this.selectedType = typeSelect.value;
			this.searchResults = [];
			this.renderResults();
			this.renderForm();
		});

		const searchRow = content.createDiv({ cls: 'wl-modal-row wl-search-row' });
		searchRow.createSpan({ cls: 'wl-modal-label', text: 'Search' });
		// one wrapper so mobile can stack: query on top, year + button under it
		const searchFields = searchRow.createDiv({ cls: 'wl-search-fields' });
		const searchInput = searchFields.createEl('input', {
			cls: 'wl-modal-input wl-search-query',
			attr: { type: 'text', placeholder: 'Search for a title...' },
		});
		searchInput.value = this.searchQuery;
		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value;
			if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
			this.searchDebounce = window.setTimeout(() => void this.performSearch(), 600);
		});
		const yearInput = searchFields.createEl('input', {
			cls: 'wl-modal-input wl-search-year',
			attr: { type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'Year' },
		});
		yearInput.value = this.searchYear;
		yearInput.addEventListener('input', () => {
			// digits only; the APIs want a bare YYYY
			yearInput.value = yearInput.value.replace(/\D/g, '');
			this.searchYear = yearInput.value;
			if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
			this.searchDebounce = window.setTimeout(() => void this.performSearch(), 600);
		});

		const searchBtn = searchFields.createEl('button', { cls: 'wl-btn', text: 'Search' });
		searchBtn.addEventListener('click', () => void this.performSearch());

		this.resultsEl = content.createDiv({ cls: 'wl-modal-results' });
		this.pagerEl = content.createDiv({ cls: 'wl-result-pager' });
		this.formEl = content.createDiv({ cls: 'wl-modal-form' });
		this.renderForm();
	}

	private async performSearch(): Promise<void> {
		if (!this.searchQuery.trim()) return;
		const gen = ++this.searchGeneration;
		this.isSearching = true;
		this.resultPage = 0;
		this.renderResults();
		try {
			const api = this.plugin.apiService;
			const activeApi = this.plugin.settings.activeApi ?? 'OMDb';
			const apiGroup = getApiGroupForType(this.selectedType, this.plugin.settings.typeApiMapping);
			const isMovie = this.selectedType === 'Movie';
			let results: SearchResult[] = [];
			if (apiGroup === '') {
				new Notice(`No API configured for type "${this.selectedType}". Configure it in Settings → API.`);
			} else if (apiGroup === 'anime') {
				const animeSource = this.plugin.settings.animeApiSource ?? 'jikan';
				results = animeSource === 'anilist'
					? await api.searchAniList(this.searchQuery, this.searchYear)
					: await api.searchAnime(this.searchQuery, this.searchYear, SEARCH_RESULT_LIMIT);
			} else if (activeApi === 'TMDB') {
				results = await api.searchTmdb(this.searchQuery, isMovie ? 'movie' : 'series', this.searchYear);
			} else {
				results = await api.searchOmdb(this.searchQuery, isMovie ? 'movie' : 'series', this.searchYear);
			}
			if (gen !== this.searchGeneration) return; // stale
			this.searchError = '';
			this.searchResults = results;
		} catch (err) {
			if (gen !== this.searchGeneration) return;
			this.searchError = apiErrorMessage(err);
			this.searchResults = [];
		} finally {
			if (gen === this.searchGeneration) {
				this.isSearching = false;
				this.renderResults();
			}
		}
	}

	private renderResults(): void {
		if (!this.resultsEl) return;
		this.resultsEl.empty();
		this.renderPager();
		if (this.isSearching) { this.resultsEl.createDiv({ cls: 'wl-modal-loading', text: 'Searching...' }); return; }
		if (this.searchError) {
			const msg = this.resultsEl.createDiv({ cls: 'wl-modal-no-api wl-modal-api-error' });
			msg.createSpan({ cls: 'wl-modal-no-api-icon', text: '⚠' });
			msg.createSpan({ cls: 'wl-modal-no-api-text', text: this.searchError });
			return;
		}
		if (!this.searchResults.length) return;
		const start = this.resultPage * SEARCH_PAGE_SIZE;
		this.searchResults.slice(start, start + SEARCH_PAGE_SIZE).forEach((result, i) => {
			const item = this.resultsEl!.createDiv({ cls: 'wl-result-item' });
			const epText = isAnimeResult(result) ? `${result.episodes} eps` : result.episodes > 0 ? `${result.episodes} eps` : result.mediaType;
			item.createDiv({ cls: 'wl-result-title', text: result.title });
			item.createDiv({ cls: 'wl-result-meta', text: `${epText} · ${formatDateDisplay(result.releaseDate)}` });
			item.dataset['idx'] = String(start + i);
			item.addEventListener('click', () => void this.selectResult(result, item));
		});
	}

	private renderPager(): void {
		if (!this.pagerEl) return;
		this.pagerEl.empty();
		const total = Math.ceil(this.searchResults.length / SEARCH_PAGE_SIZE);
		if (this.isSearching || total <= 1) return;

		const prev = this.pagerEl.createEl('button', { cls: 'wl-btn wl-result-pager-btn', text: '‹' });
		prev.disabled = this.resultPage === 0;
		prev.addEventListener('click', () => this.goToPage(this.resultPage - 1));

		this.pagerEl.createSpan({ cls: 'wl-result-pager-info', text: `Page ${this.resultPage + 1} of ${total}` });

		const next = this.pagerEl.createEl('button', { cls: 'wl-btn wl-result-pager-btn', text: '›' });
		next.disabled = this.resultPage >= total - 1;
		next.addEventListener('click', () => this.goToPage(this.resultPage + 1));
	}

	private goToPage(page: number): void {
		const total = Math.ceil(this.searchResults.length / SEARCH_PAGE_SIZE);
		this.resultPage = Math.max(0, Math.min(page, total - 1));
		this.renderResults();
		this.resultsEl?.scrollTo({ top: 0 });
	}

	private async selectResult(result: SearchResult, itemEl: HTMLElement): Promise<void> {
		if (this.resultsEl) {
			for (const child of Array.from(this.resultsEl.children)) child.removeClass('is-selected');
		}
		itemEl.addClass('is-selected');
		const gen = ++this.searchGeneration;
		const api = this.plugin.apiService;
		const activeApi = this.plugin.settings.activeApi ?? 'OMDb';
		try {
			if (!isAnimeResult(result) && result.mediaType === 'tv') {
				const full = activeApi === 'TMDB' ? await api.getTmdbTvDetails(result.imdbId) : await api.getOmdbTvDetails(result.imdbId);
				if (gen !== this.searchGeneration) return;
				if (full) { this.media.title = full.title; this.media.episodes = full.episodes; this.media.duration = full.episodeDuration; this.media.releaseDate = full.releaseDate; this.media.link = full.url; }
			} else if (!isAnimeResult(result) && result.mediaType === 'movie') {
				const full = activeApi === 'TMDB' ? await api.getTmdbMovieDetails(result.imdbId) : await api.getOmdbMovieDetails(result.imdbId);
				if (gen !== this.searchGeneration) return;
				if (full) { this.media.title = full.title; this.media.episodes = full.episodes; this.media.duration = full.episodeDuration; this.media.releaseDate = full.releaseDate; this.media.link = full.url; }
			} else {
				const anime = result as AnimeSearchResult;
				this.media.title = anime.title; this.media.episodes = anime.episodes; this.media.duration = anime.duration;
				this.media.releaseDate = anime.releaseDate; this.media.link = anime.url;
			}
		} catch {
			if (gen !== this.searchGeneration) return;
			this.media.title = result.title;
			this.media.episodes = result.episodes;
			this.media.duration = isAnimeResult(result) ? result.duration : result.episodeDuration;
			this.media.releaseDate = result.releaseDate; this.media.link = result.url;
		}
		if (gen !== this.searchGeneration) return;
		this.renderForm();
	}

	private renderForm(): void {
		const form = resetForm(this.formEl);
		if (!form) return;
		renderMediaFields(form, this.media, false);

		const btnRow = form.createDiv({ cls: 'wl-modal-btn-row' });
		const addBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Add to maybe' });
		addBtn.addEventListener('click', () => void this.addMaybeTitle());
	}

	private async addMaybeTitle(): Promise<void> {
		const titleName = this.media.title.trim();
		if (!titleName) { new Notice('Please enter a title name.'); return; }

		const entry: MaybeTitle = {
			id: this.dataManager.generateMaybeId(titleName),
			title: titleName,
			type: this.selectedType,
			releaseDate: this.media.releaseDate || null,
			externalLink: this.media.link,
			totalEpisodes: this.media.episodes,
			episodeDuration: this.media.duration,
			dateAdded: new Date().toISOString(),
		};
		await this.dataManager.addMaybeTitle(entry);
		new Notice(`"${titleName}" added to Maybe.`);
		this.close();
		this.onAdded();
	}
}

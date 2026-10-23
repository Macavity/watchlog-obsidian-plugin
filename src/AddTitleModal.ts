import { App, Modal, Notice } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type {
	WatchLogTitle,
	WatchLogGroup,
	AnimeSearchResult,
	MediaSearchResult,
	Season,
} from './types';
import { getApiGroupForType, todayIso } from './types';
import { renderSearchResultRow } from './SearchThumbnail';
import { apiErrorMessage, SEARCH_PAGE_SIZE, SEARCH_RESULT_LIMIT } from './ApiService';
import { LibraryIndex, animeResultIdKeys, mediaResultIdKeys } from './LibraryIndex';
import { createDatePicker } from './DatePicker';
import { renderStarRating } from './StarRating';
import { blockDuplicate, createDuplicateGuard } from './ui/DuplicateGuard';
import {
	makeCell,
	makeRow as makeFormRow,
	nameSelect,
	renderGroupPicker,
	renderMediaFields,
	resetForm,
	type GroupPickerState,
	type MediaFields,
} from './ui/FormCells';

type SearchResult = AnimeSearchResult | MediaSearchResult;

function isAnimeResult(r: SearchResult): r is AnimeSearchResult {
	return 'malId' in r;
}

export class AddTitleModal extends Modal {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	// gets the new entry — callers that don't care just ignore it
	private onAdded: (entry: WatchLogTitle) => void;

	private selectedType = 'Anime';
	private searchQuery = '';
	private searchYear = '';
	private searchResults: SearchResult[] = [];
	private resultPage = 0;
	private isSearching = false;
	private searchGeneration = 0;
	private autoSearch = false;
	private noApiMessage = '';
	private searchError = '';

	private media: MediaFields = { title: '', episodes: 0, duration: 0, releaseDate: '', link: '' };
	private fieldSeasons: Season[] = [];
	private fieldStatus = 'Plan to watch';
	private fieldPriority = 'Medium';
	private fieldRating = 0;
	private fieldDateStarted = '';
	private fieldMalId: number | null = null;
	private fieldAnilistId: number | null = null;
	// trailer resolved at selection ('' unfetched, 'none' source without one, or a URL)
	private fieldTrailerUrl = '';
	// credits resolved at selection ([] unfetched, ['none'] unavailable, or names)
	private fieldDirector: string[] = [];
	private fieldCast: string[] = [];
	private fieldStudio: string[] = [];
	private duplicates = createDuplicateGuard();
	// built on first search, reused for the modal's life
	private libIndex: LibraryIndex | null = null;

	private group: GroupPickerState = { selectedGroupId: '', newGroupName: '' };

	private resultsEl: HTMLElement | null = null;
	private pagerEl: HTMLElement | null = null;
	private formEl: HTMLElement | null = null;
	private searchDebounce: number | null = null;

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		dataManager: DataManager,
		onAdded: (entry: WatchLogTitle) => void,
		prefill?: {
			title?: string;
			searchQuery?: string;
			type: string;
			episodes: number;
			duration: number;
			releaseDate: string;
			link: string;
			seasons: Season[];
			trailerUrl?: string;
			director?: string[];
			cast?: string[];
		},
	) {
		super(app);
		this.plugin = plugin;
		this.dataManager = dataManager;
		this.onAdded = onAdded;
		// preselect the resolved default type; a prefill type (e.g. from URL detection) overrides it below
		this.selectedType = this.plugin.resolveDefaultAddType() || this.selectedType;
		if (prefill) {
			this.selectedType = prefill.type;
			if (prefill.title) {
				this.media.title = prefill.title;
			}
			if (prefill.searchQuery) {
				this.searchQuery = prefill.searchQuery;
				this.autoSearch = true;
			}
			this.media.episodes = prefill.episodes;
			this.media.duration = prefill.duration;
			this.media.releaseDate = prefill.releaseDate;
			this.media.link = prefill.link;
			this.fieldSeasons = prefill.seasons;
			if (prefill.trailerUrl !== undefined) this.fieldTrailerUrl = prefill.trailerUrl;
			if (prefill.director !== undefined) this.fieldDirector = prefill.director;
			if (prefill.cast !== undefined) this.fieldCast = prefill.cast;
		}
	}

	onOpen(): void {
		this.titleEl.setText('Add title');
		this.contentEl.addClass('wl-add-modal');
		this.buildUI();
		if (this.autoSearch) {
			void this.performSearch();
		}
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
			this.noApiMessage = '';
			this.searchError = '';
			this.renderResults();
			this.renderForm();
		});

		const searchRow = content.createDiv({ cls: 'wl-modal-row wl-search-row' });
		searchRow.createSpan({ cls: 'wl-modal-label', text: 'Search' });
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

		this.resultsEl = content.createDiv({ cls: 'wl-modal-results wl-results-grid' });
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
			let noApi = '';
			if (apiGroup === '') {
				noApi = `No API configured for type "${this.selectedType}". Go to Settings → API to set one up.`;
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
			this.noApiMessage = noApi;
			this.searchError = '';
			this.searchResults = results;
		} catch (err) {
			if (gen !== this.searchGeneration) return;
			// in the panel, not a Notice — a blank result list is what made a rejected key
			// look like a title that does not exist
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

		if (this.isSearching) {
			this.resultsEl.createDiv({ cls: 'wl-modal-loading', text: 'Searching...' });
			return;
		}

		if (this.noApiMessage) {
			const msg = this.resultsEl.createDiv({ cls: 'wl-modal-no-api' });
			msg.createSpan({ cls: 'wl-modal-no-api-icon', text: 'ℹ' });
			msg.createSpan({ cls: 'wl-modal-no-api-text', text: this.noApiMessage });
			return;
		}

		if (this.searchError) {
			const msg = this.resultsEl.createDiv({ cls: 'wl-modal-no-api wl-modal-api-error' });
			msg.createSpan({ cls: 'wl-modal-no-api-icon', text: '⚠' });
			msg.createSpan({ cls: 'wl-modal-no-api-text', text: this.searchError });
			return;
		}

		if (this.searchResults.length === 0) return;

		if (!this.libIndex) this.libIndex = LibraryIndex.build(this.plugin, ['watchlist']);
		const libIndex = this.libIndex;
		const activeApi = this.plugin.settings.activeApi ?? 'OMDb';

		const start = this.resultPage * SEARCH_PAGE_SIZE;
		this.searchResults.slice(start, start + SEARCH_PAGE_SIZE).forEach((result, i) => {
			const epText = isAnimeResult(result)
				? `${result.episodes} eps`
				: result.episodes > 0 ? `${result.episodes} eps` : result.mediaType;
			const idKeys = isAnimeResult(result)
				? animeResultIdKeys(result)
				: mediaResultIdKeys(result, activeApi);
			const item = renderSearchResultRow(this.resultsEl!, {
				thumbUrl: result.posterUrl,
				fallbackIcon: '🎬',
				title: result.title,
				meta: `${epText} · ${result.releaseDate}`,
				inLibrary: libIndex.lookup(idKeys, result.title),
				onClick: (itemEl) => void this.selectResult(result, itemEl),
			});
			item.dataset['idx'] = String(start + i);
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

		this.pagerEl.createSpan({
			cls: 'wl-result-pager-info',
			text: `Page ${this.resultPage + 1} of ${total}`,
		});

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
			for (const child of Array.from(this.resultsEl.children)) {
				child.removeClass('is-selected');
			}
		}
		itemEl.addClass('is-selected');

		const gen = ++this.searchGeneration;
		const api = this.plugin.apiService;
		const activeApi = this.plugin.settings.activeApi ?? 'OMDb';
		try {
			if (!isAnimeResult(result) && result.mediaType === 'tv') {
				const full = activeApi === 'TMDB'
					? await api.getTmdbTvDetails(result.imdbId)
					: await api.getOmdbTvDetails(result.imdbId);
				if (gen !== this.searchGeneration) return;
				if (full) {
					this.media.title = full.title;
					this.media.episodes = full.episodes;
					this.media.duration = full.episodeDuration;
					this.media.releaseDate = full.releaseDate;
					this.media.link = full.url;
					this.fieldSeasons = full.seasons;
					this.fieldTrailerUrl = full.trailerUrl ?? '';
					this.fieldDirector = full.director ?? [];
					this.fieldCast = full.cast ?? [];
					this.fieldStudio = full.studio ?? [];
				}
			} else if (!isAnimeResult(result) && result.mediaType === 'movie') {
				const full = activeApi === 'TMDB'
					? await api.getTmdbMovieDetails(result.imdbId)
					: await api.getOmdbMovieDetails(result.imdbId);
				if (gen !== this.searchGeneration) return;
				if (full) {
					this.media.title = full.title;
					this.media.episodes = full.episodes;
					this.media.duration = full.episodeDuration;
					this.media.releaseDate = full.releaseDate;
					this.media.link = full.url;
					this.fieldSeasons = full.seasons;
					this.fieldTrailerUrl = full.trailerUrl ?? '';
					this.fieldDirector = full.director ?? [];
					this.fieldCast = full.cast ?? [];
					this.fieldStudio = full.studio ?? [];
				}
			} else {
				const anime = result as AnimeSearchResult;
				this.media.title = anime.title;
				this.media.episodes = anime.episodes;
				this.media.duration = anime.duration;
				this.media.releaseDate = anime.releaseDate;
				this.media.link = anime.url;
				this.fieldSeasons = anime.seasons;
				this.fieldTrailerUrl = anime.trailerUrl ?? '';
				// anime sources don't carry credits — clear any stale movie/TV selection.
				// studio is backfilled from Jikan/AniList on first modal open.
				this.fieldDirector = [];
				this.fieldCast = [];
				this.fieldStudio = [];
				if (anime.anilistId && anime.anilistId > 0) {
					this.fieldAnilistId = anime.anilistId;
					this.fieldMalId = null;
				} else {
					this.fieldMalId = anime.malId;
					this.fieldAnilistId = null;
				}
			}
		} catch {
			this.media.title = result.title;
			this.media.episodes = isAnimeResult(result) ? result.episodes : result.episodes;
			this.media.duration = isAnimeResult(result) ? result.duration : result.episodeDuration;
			this.media.releaseDate = result.releaseDate;
			this.media.link = result.url;
			this.fieldSeasons = result.seasons;
			// anime search results already carry a trailer; movie/TV list rows do not
			this.fieldTrailerUrl = result.trailerUrl ?? '';
			this.fieldDirector = !isAnimeResult(result) ? (result.director ?? []) : [];
			this.fieldCast = !isAnimeResult(result) ? (result.cast ?? []) : [];
			this.fieldStudio = !isAnimeResult(result) ? (result.studio ?? []) : [];
		}

		this.renderForm();
	}

	private renderForm(): void {
		const form = resetForm(this.formEl);
		if (!form) return;
		const makeRow = (label: string): HTMLElement => makeFormRow(form, label);

		renderMediaFields(form, this.media, true);

		// status + priority paired 50/50 (status excludes "To be released" — it follows releaseDate)
		const statusPriRow = form.createDiv({ cls: 'wl-modal-row wl-modal-row-pair' });
		const statuses = this.plugin.settings.statuses.filter((s) => s.name !== 'To be released');
		nameSelect(makeCell(statusPriRow, 'Status'), statuses.map((s) => s.name), this.fieldStatus,
			(v) => { this.fieldStatus = v; });
		nameSelect(makeCell(statusPriRow, 'Priority', true), this.plugin.settings.priorities.map((p) => p.name),
			this.fieldPriority, (v) => { this.fieldPriority = v; });

		const ratingRow = makeRow('Rating');
		const starsWrap = ratingRow.createDiv({ cls: 'wl-stars' });
		const paintStars = (): void => {
			renderStarRating(starsWrap, this.fieldRating, {
				allowHalf: this.plugin.settings.halfStarRatings ?? false,
				tiers: this.plugin.settings.ratingSystem,
				showLabel: true,
				onChange: (value) => { this.fieldRating = value; paintStars(); },
			});
		};
		paintStars();

		const startRow = makeRow('Date started');
		createDatePicker({
			parent: startRow,
			inputCls: 'wl-modal-input',
			value: this.fieldDateStarted || null,
			onChange: (iso) => { this.fieldDateStarted = iso ?? ''; },
		});

		renderGroupPicker(form, this.dataManager.getGroups(), this.group);

		if (this.fieldSeasons.length > 0) {
			const seasRow = makeRow('Seasons');
			seasRow.createSpan({
				cls: 'wl-modal-info',
				text: this.fieldSeasons.map((s) => `${s.name} (${s.episodes} eps)`).join(', '),
			});
		}

		const btnRow = form.createDiv({ cls: 'wl-modal-btn-row' });
		const addBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Add to watchlog' });
		addBtn.addEventListener('click', () => void this.addTitle());
	}

	private async addTitle(): Promise<void> {
		const titleName = this.media.title.trim();
		if (!titleName) {
			new Notice('Please enter a title name.');
			return;
		}

		const isDuplicate = this.dataManager.getTitles().some(
			(t) => t.title.toLowerCase() === titleName.toLowerCase()
		);
		const blocked = blockDuplicate(this.contentEl, this.duplicates, {
			name: titleName,
			isDuplicate,
			verb: 'Add',
			retry: () => void this.addTitle(),
		});
		if (blocked) return;

		const entry: WatchLogTitle = {
			id: this.dataManager.generateId(titleName),
			title: titleName,
			type: this.selectedType,
			status: this.fieldStatus,
			priority: this.fieldPriority,
			review: '',
			rating: this.fieldRating,
			notes: '',
			dateStarted: this.fieldDateStarted || null,
			dateFinished: null,
			dateAdded: new Date().toISOString(),
			dateModified: new Date().toISOString(),
			totalEpisodes: this.media.episodes,
			episodeDuration: this.media.duration,
			releaseDate: this.media.releaseDate || null,
			externalLink: this.media.link,
			seasons: this.fieldSeasons,
			watchedEpisodes: [],
			favorite: false,
			posterUrl: '',
			trailerUrl: this.fieldTrailerUrl,
			manualTrailerUrl: '',
			// empty stays absent (= unfetched) so the detail modal's lazy backfill runs
			...(this.fieldDirector.length > 0 ? { director: this.fieldDirector } : {}),
			...(this.fieldCast.length > 0 ? { cast: this.fieldCast } : {}),
			...(this.fieldStudio.length > 0 ? { studio: this.fieldStudio } : {}),
			...(this.fieldMalId !== null ? { malId: this.fieldMalId } : {}),
			...(this.fieldAnilistId !== null ? { anilistId: this.fieldAnilistId } : {}),
		};

		// auto-complete episodes when adding with Completed status
		if (entry.status === 'Completed' && entry.totalEpisodes > 0) {
			entry.watchedEpisodes = Array.from({ length: entry.totalEpisodes }, (_, i) => i + 1);
			if (this.plugin.settings.setFinishDateAutomatically) {
				entry.dateFinished = todayIso();
			}
		}

		await this.dataManager.addTitle(entry);

		// remember the type actually used so "Last type used" can follow it
		this.plugin.settings.lastAddedType = entry.type;
		void this.plugin.saveSettings();

		// fire-and-forget community rating fetch (non-blocking)
		void (async () => {
			const animeSource = this.plugin.settings.animeApiSource ?? 'jikan';
			const group = getApiGroupForType(entry.type, this.plugin.settings.typeApiMapping);
			if (group === '') return;
			const result = await this.plugin.apiService.fetchCommunityRating(entry, animeSource, group);
			if (result) {
				this.dataManager.updateCommunityRating(entry.id, result.rating, result.votes, result.source);
			}
		})();

		if (this.group.selectedGroupId) {
			await this.dataManager.addTitleToGroup(this.group.selectedGroupId, entry.id);
		} else if (this.group.newGroupName.trim()) {
			const name = this.group.newGroupName.trim();
			const group: WatchLogGroup = {
				id: this.dataManager.generateGroupId(name),
				name,
				titleIds: [entry.id],
				dateAdded: new Date().toISOString(),
			};
			await this.dataManager.addGroup(group);
		}

		new Notice(`"${titleName}" added to WatchLog.`);
		this.close();
		this.onAdded(entry);
	}
}

import { App, FuzzySuggestModal, Modal, Notice, TFile } from 'obsidian';
import type WatchLogPlugin from './main';
import type { ReadingDataManager } from './ReadingDataManager';
import type { BookSearchResult, MangaSearchResult } from './ApiService';
import { apiErrorMessage } from './ApiService';
import { renderSearchResultRow } from './SearchThumbnail';
import { LibraryIndex, bookResultIdKeys, mangaResultIdKeys } from './LibraryIndex';
import { renderStarRating } from './StarRating';
import { createDatePicker } from './DatePicker';
import { renderSegmentedToggle } from './StatusDropdown';
import { t } from './i18n';
import { readingStatusLabel } from './i18n/labels';
import {
	Book,
	BookProgressUnit,
	Manga,
	ReadingStatus,
	SELECTABLE_READING_STATUSES,
} from './types';

export type ReadingMode = 'book' | 'manga';

interface ReadingFormState {
	title: string;
	author: string;
	status: ReadingStatus;
	rating: number;
	progressUnit: BookProgressUnit;
	pagesRead: number;
	totalPages: number;
	wordsRead: number;
	totalWords: number;
	chaptersRead: number;
	totalChapters: number;
	volumesRead: number;
	totalVolumes: number;
	coverUrl: string;
	googleBooksId: string;
	malId: string;
	vaultPage: string;
	dateStarted: string | null;
	dateFinished: string | null;
	releaseDate: string | null;
}

function emptyFormState(): ReadingFormState {
	return {
		title: '',
		author: '',
		status: 'Plan to Read',
		rating: 0,
		progressUnit: 'pages',
		pagesRead: 0,
		totalPages: 0,
		wordsRead: 0,
		totalWords: 0,
		chaptersRead: 0,
		totalChapters: 0,
		volumesRead: 0,
		totalVolumes: 0,
		coverUrl: '',
		googleBooksId: '',
		malId: '',
		vaultPage: '',
		dateStarted: null,
		dateFinished: null,
		releaseDate: null,
	};
}

export class VaultFilePicker extends FuzzySuggestModal<TFile> {
	private onPick: (file: TFile) => void;
	private files: TFile[];

	constructor(app: App, files: TFile[], onPick: (file: TFile) => void) {
		super(app);
		this.files = files;
		this.onPick = onPick;
		this.setPlaceholder(t('add.reading.pickNote'));
	}

	getItems(): TFile[] {
		return this.files;
	}
	getItemText(item: TFile): string {
		return item.path;
	}
	onChooseItem(item: TFile): void {
		this.onPick(item);
	}
}

export class AddReadingModal extends Modal {
	private plugin: WatchLogPlugin;
	private readingData: ReadingDataManager;
	private mode: ReadingMode;
	private state: ReadingFormState;
	private existingId: string | null;
	private onSaved: () => void;
	private starsWrap: HTMLElement | null = null;
	private lookupResultsEl: HTMLElement | null = null;
	private formEl: HTMLElement | null = null;
	private openVaultBtn: HTMLButtonElement | null = null;
	private linkVaultBtn: HTMLButtonElement | null = null;
	private lookupSearchGen = 0;
	private selectGen = 0;
	// cover last prefilled from an API result (or the cached one when editing); unchanged it is not an override
	private prefillSearch: string;
	private searchDebounce: number | null = null;
	// built on first lookup, reused for the modal's life
	private libIndex: LibraryIndex | null = null;

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		readingData: ReadingDataManager,
		mode: ReadingMode,
		onSaved: () => void,
		initial?: { state: ReadingFormState; id: string },
		prefillSearch?: string,
	) {
		super(app);
		this.plugin = plugin;
		this.readingData = readingData;
		this.mode = mode;
		this.state = initial ? { ...initial.state } : emptyFormState();
		if (!initial) {
			const defStatus = readingData.getSettings().defaultStatus;
			if (defStatus) this.state.status = defStatus;
		}
		this.existingId = initial?.id ?? null;
		this.onSaved = onSaved;
		this.prefillSearch = prefillSearch ?? '';
	}

	onOpen(): void {
		const colorTheme = this.plugin.settings.colorTheme ?? 'default';
		this.modalEl.setAttribute('data-theme', colorTheme);
		this.contentEl.setAttribute('data-theme', colorTheme);
		this.contentEl.addClass('wl-view');
		this.contentEl.addClass('wl-reading-modal');
		this.contentEl.addClass(this.mode === 'book' ? 'wl-reading-modal-book' : 'wl-reading-modal-manga');
		this.titleEl.setText(this.headerTitle());
		this.buildUI();
	}

	onClose(): void {
		if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
		this.contentEl.empty();
	}

	private headerTitle(): string {
		if (this.existingId) {
			return this.mode === 'book' ? t('add.reading.editBook') : t('add.reading.editManga');
		}
		return this.mode === 'book' ? t('add.reading.addBook') : t('add.reading.addManga');
	}

	private buildUI(): void {
		const c = this.contentEl;
		c.empty();

		this.renderHeaderRow(c);
		this.renderLookupBar(c);
		c.createDiv({ cls: 'wl-reading-modal-divider' });
		this.formEl = c.createDiv({ cls: 'wl-reading-form-wrap' });
		this.renderForm(this.formEl);
		this.renderFooter(c);
	}

	private renderHeaderRow(parent: HTMLElement): void {
		const row = parent.createDiv({ cls: 'wl-reading-modal-header' });
		const left = row.createDiv({ cls: 'wl-reading-modal-header-left' });
		left.createSpan({
			cls: 'wl-reading-modal-header-icon',
			text: this.mode === 'book' ? '📖' : '📓',
		});
		left.createSpan({
			cls: 'wl-reading-modal-header-title',
			text: this.headerTitle(),
		});

		const actions = row.createDiv({ cls: 'wl-reading-modal-header-actions' });
		// no "Link" button here on purpose — vault-page linking lives in ReadingDetailModal
		this.openVaultBtn = actions.createEl('button', {
			cls: 'wl-btn wl-btn-sm',
			text: t('add.reading.open'),
		});
		this.openVaultBtn.addEventListener('click', () => this.openLinkedVaultPage());
		this.refreshVaultButtons();
	}

	private refreshVaultButtons(): void {
		if (this.linkVaultBtn) {
			this.linkVaultBtn.textContent = this.state.vaultPage ? t('add.reading.changeLink') : t('add.reading.link');
			this.linkVaultBtn.title = this.state.vaultPage
				? t('add.reading.linked', { path: this.state.vaultPage })
				: t('add.reading.linkTip');
		}
		if (this.openVaultBtn) {
			const hasLink = !!this.state.vaultPage;
			this.openVaultBtn.disabled = !hasLink;
			this.openVaultBtn.toggleClass('is-hidden', !hasLink);
		}
	}

	private openLinkedVaultPage(): void {
		const path = this.state.vaultPage;
		if (!path) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			void this.plugin.app.workspace.getLeaf('tab').openFile(file);
			this.close();
		} else {
			new Notice(t('add.reading.linkMissing'));
		}
	}

	private renderLookupBar(parent: HTMLElement): void {
		const lookup = parent.createDiv({ cls: 'wl-reading-lookup' });
		const input = lookup.createEl('input', {
			cls: 'wl-modal-input wl-reading-lookup-input',
			attr: {
				type: 'text',
				placeholder: this.mode === 'book'
					? t('add.reading.searchBook')
					: t('add.reading.searchManga'),
			},
		});
		const fetchBtn = lookup.createEl('button', {
			cls: 'wl-btn wl-reading-lookup-btn',
			text: t('common.search'),
		});
		this.lookupResultsEl = parent.createDiv({ cls: 'wl-modal-results wl-results-grid' });

		const runFetch = (): void => {
			const q = input.value.trim();
			if (!q) {
				new Notice(t('add.reading.searchFirst'));
				return;
			}
			void this.performLookup(q);
		};

		// auto-search as you type (debounced), matching the Watchlist/Games add flows; the button and Enter
		// stay as manual triggers
		input.addEventListener('input', () => {
			if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
			const q = input.value.trim();
			if (!q) return;
			this.searchDebounce = window.setTimeout(() => void this.performLookup(q), 600);
		});

		fetchBtn.addEventListener('click', runFetch);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				runFetch();
			}
		});

		// a prefilled search (e.g. from Drafts) fires immediately — the results are the point
		if (this.prefillSearch) {
			input.value = this.prefillSearch;
			void this.performLookup(this.prefillSearch);
		}
	}

	private async performLookup(query: string): Promise<void> {
		const gen = ++this.lookupSearchGen;
		if (!this.lookupResultsEl) return;
		this.lookupResultsEl.empty();
		this.lookupResultsEl.createDiv({ cls: 'wl-modal-loading', text: t('ui.picker.searching') });

		try {
			if (this.mode === 'book') {
				if (!this.plugin.apiService.hasGoogleBooksKey()) {
					if (gen !== this.lookupSearchGen) return;
					this.lookupResultsEl.empty();
					this.lookupResultsEl.createDiv({
						cls: 'wl-modal-loading',
						text: t('add.reading.needGoogleKey'),
					});
					return;
				}
				const results = await this.plugin.apiService.searchGoogleBooks(query);
				if (gen !== this.lookupSearchGen) return;
				this.renderLookupResults(results, '📖', (r) => this.applyBookResult(r), bookResultIdKeys);
			} else {
				const isNumeric = /^\d+$/.test(query);
				let results: MangaSearchResult[];
				if (isNumeric) {
					const single = await this.plugin.apiService.getMangaByMalId(parseInt(query, 10));
					if (gen !== this.lookupSearchGen) return;
					results = single ? [single] : [];
				} else {
					results = await this.plugin.apiService.searchManga(query);
					if (gen !== this.lookupSearchGen) return;
				}
				this.renderLookupResults(results, '📓', (r) => this.applyMangaResult(r), mangaResultIdKeys);
			}
		} catch (err) {
			if (gen !== this.lookupSearchGen) return;
			this.lookupResultsEl.empty();
			this.lookupResultsEl.createDiv({ cls: 'wl-modal-error', text: apiErrorMessage(err) });
		}
	}

	/**
	 * Shared renderer for book and manga lookup results (they differ only by fallback icon and apply
	 * handler). Rows use the shared add-flow markup.
	 */
	private renderLookupResults<T extends { title: string; author: string; year: number; coverUrl: string }>(
		results: T[],
		fallbackIcon: string,
		onPick: (r: T) => void,
		idKeys: (r: T) => string[],
	): void {
		if (!this.lookupResultsEl) return;
		this.lookupResultsEl.empty();
		if (results.length === 0) {
			this.lookupResultsEl.createDiv({ cls: 'wl-modal-loading', text: t('add.noMatches') });
			return;
		}
		// books check Books, manga check Manga — the two libraries stay separate
		if (!this.libIndex) {
			this.libIndex = LibraryIndex.build(this.plugin, [this.mode === 'book' ? 'books' : 'manga']);
		}
		const libIndex = this.libIndex;
		for (const r of results) {
			const meta = [r.author || t('add.reading.unknownAuthor'), r.year ? String(r.year) : ''].filter(Boolean).join(' · ');
			renderSearchResultRow(this.lookupResultsEl, {
				thumbUrl: r.coverUrl,
				fallbackIcon,
				title: r.title || t('add.reading.untitled'),
				meta,
				inLibrary: libIndex.lookup(idKeys(r), r.title),
				onClick: () => onPick(r),
			});
		}
	}

	private applyBookResult(r: BookSearchResult): void {
		// always overwrite the auto-populated fields, so re-selecting a different result fully replaces the
		// previous selection
		const gen = ++this.selectGen;
		this.state.title = r.title;
		this.state.author = r.author;
		this.state.totalPages = r.totalPages;
		this.state.coverUrl = r.coverUrl;
		this.state.googleBooksId = r.googleBooksId;
		this.state.releaseDate = r.releaseDate ?? '';
		this.refreshForm();
		// keep the results list open so another result can be picked.
		// search results sometimes omit page counts and only return thumbnails — fetch the full volume for
		// the selected book to upgrade both.
		if (r.googleBooksId) {
			void (async () => {
				try {
					const detail = await this.plugin.apiService.getGoogleBookById(r.googleBooksId);
					if (gen !== this.selectGen || !detail) return; // a newer selection superseded this one
					if (detail.totalPages > 0) this.state.totalPages = detail.totalPages;
					if (detail.coverUrl) {
						this.state.coverUrl = detail.coverUrl;
					}
					this.refreshForm();
				} catch {
					// best-effort enrichment; the book is already applied from the search results
				}
			})();
		}
	}

	private applyMangaResult(r: MangaSearchResult): void {
		// always overwrite the auto-populated fields, so re-selecting a different result fully replaces the
		// previous selection
		const gen = ++this.selectGen;
		this.state.title = r.title;
		this.state.author = r.author;
		this.state.totalChapters = r.totalChapters;
		this.state.totalVolumes = r.totalVolumes;
		this.state.coverUrl = r.coverUrl;
		this.state.malId = r.malId > 0 ? String(r.malId) : '';
		this.state.releaseDate = r.releaseDate ?? '';
		this.refreshForm();
		// keep the results list open so another result can be picked.
		// search returns null chapters/volumes for ongoing titles — fetch detail only for the selected manga.
		if (r.malId > 0) {
			void (async () => {
				const detail = await this.plugin.apiService.getMangaByMalId(r.malId);
				if (gen !== this.selectGen || !detail) return; // superseded or no data
				this.state.totalChapters = detail.totalChapters > 0 ? detail.totalChapters : this.state.totalChapters;
				this.state.totalVolumes = detail.totalVolumes > 0 ? detail.totalVolumes : this.state.totalVolumes;
				this.refreshForm();
			})();
		}
	}

	private refreshForm(): void {
		if (!this.formEl) return;
		this.formEl.empty();
		this.renderForm(this.formEl);
	}

	private renderForm(parent: HTMLElement): void {
		const form = parent.createDiv({ cls: 'wl-reading-form' });

		this.renderTextField(form, t('ui.form.title'), t('add.reading.bookTitlePlaceholder'), this.state.title, (v) => {
			this.state.title = v;
		});

		this.renderTextField(form, t('add.reading.author'), t('add.reading.authorPlaceholder'), this.state.author, (v) => {
			this.state.author = v;
		});

		this.renderStatusRatingRow(form);

		this.renderProgressOptionalGrid(form);
	}

	private renderProgressOptionalGrid(parent: HTMLElement): void {
		const grid = parent.createDiv({ cls: 'wl-reading-form-grid' });

		const progressCol = grid.createDiv({ cls: 'wl-reading-form-grid-col' });
		const progressLabel = progressCol.createDiv({ cls: 'wl-reading-section-label' });
		progressLabel.createSpan({ text: t('add.reading.progress') });
		if (this.mode === 'book') {
			progressLabel.addClass('wl-reading-section-label-row');
			// Pages/Words switch: swaps which counter pair the form collects. The other unit's numbers stay in
			// state, so flipping back is lossless.
			renderSegmentedToggle<BookProgressUnit>({
				parent: progressLabel,
				options: [
					{ value: 'pages', label: t('add.reading.pages'), title: t('add.reading.pagesTip') },
					{ value: 'words', label: t('add.reading.words'), title: t('add.reading.wordsTip') },
				],
				value: this.state.progressUnit,
				onPick: (unit) => {
					this.state.progressUnit = unit;
					this.refreshForm();
				},
			});
		}
		if (this.mode === 'book') {
			const inWords = this.state.progressUnit === 'words';
			this.renderTwoNumberRow(
				progressCol,
				inWords
					? { label: t('add.reading.wordsRead'), value: this.state.wordsRead, onChange: (n) => { this.state.wordsRead = n; } }
					: { label: t('add.reading.pagesRead'), value: this.state.pagesRead, onChange: (n) => { this.state.pagesRead = n; } },
				{ label: t('add.reading.chaptersRead'), value: this.state.chaptersRead, onChange: (n) => { this.state.chaptersRead = n; } },
			);
			this.renderTwoNumberRow(
				progressCol,
				inWords
					? { label: t('add.reading.totalWords'), value: this.state.totalWords, onChange: (n) => { this.state.totalWords = n; } }
					: { label: t('add.reading.totalPages'), value: this.state.totalPages, onChange: (n) => { this.state.totalPages = n; } },
				{ label: t('add.reading.totalChapters'), value: this.state.totalChapters, onChange: (n) => { this.state.totalChapters = n; } },
			);
		} else {
			this.renderTwoNumberRow(
				progressCol,
				{ label: t('add.reading.chaptersRead'), value: this.state.chaptersRead, onChange: (n) => { this.state.chaptersRead = n; } },
				{ label: t('add.reading.volumesRead'), value: this.state.volumesRead, onChange: (n) => { this.state.volumesRead = n; } },
			);
			this.renderTwoNumberRow(
				progressCol,
				{ label: t('add.reading.totalChapters'), value: this.state.totalChapters, onChange: (n) => { this.state.totalChapters = n; } },
				{ label: t('add.reading.totalVolumes'), value: this.state.totalVolumes, onChange: (n) => { this.state.totalVolumes = n; } },
			);
		}

		const optionalCol = grid.createDiv({ cls: 'wl-reading-form-grid-col' });
		optionalCol.createDiv({ cls: 'wl-reading-section-label', text: t('add.reading.optional') });
		this.renderTextField(optionalCol, t('add.coverUrl'), 'https://...', this.state.coverUrl, (v) => {
			this.state.coverUrl = v;
		});
		this.renderDateField(optionalCol, t('add.reading.startDate'), this.state.dateStarted, (parsed) => {
			this.state.dateStarted = parsed;
		});
		this.renderDateField(optionalCol, t('ui.form.releaseDate'), this.state.releaseDate, (parsed) => {
			this.state.releaseDate = parsed;
		});
	}

	private renderTextField(
		parent: HTMLElement,
		label: string,
		placeholder: string,
		value: string,
		onChange: (v: string) => void,
	): void {
		const row = parent.createDiv({ cls: 'wl-reading-row' });
		row.createSpan({ cls: 'wl-reading-label', text: label });
		const input = row.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'text', placeholder },
		});
		input.value = value;
		input.addEventListener('input', () => onChange(input.value));
	}

	private renderStatusRatingRow(parent: HTMLElement): void {
		const row = parent.createDiv({ cls: 'wl-reading-status-rating-row' });

		const statusGroup = row.createDiv({ cls: 'wl-reading-inline-group' });
		statusGroup.createSpan({ cls: 'wl-reading-label', text: t('add.status') });
		const select = statusGroup.createEl('select', { cls: 'wl-select wl-reading-status-select' });
		for (const s of SELECTABLE_READING_STATUSES) {
			const opt = select.createEl('option', { text: readingStatusLabel(s), value: s });
			if (s === this.state.status) opt.selected = true;
		}
		select.addEventListener('change', () => {
			this.state.status = select.value as ReadingStatus;
		});

		const ratingGroup = row.createDiv({ cls: 'wl-reading-inline-group' });
		ratingGroup.createSpan({ cls: 'wl-reading-label', text: t('add.rating') });
		this.starsWrap = ratingGroup.createDiv({ cls: 'wl-stars wl-reading-stars' });
		this.renderStars();
	}

	private renderStars(): void {
		if (!this.starsWrap) return;
		renderStarRating(this.starsWrap, this.state.rating, {
			allowHalf: this.plugin.settings.halfStarRatings ?? false,
			tiers: this.plugin.settings.ratingSystem,
			showLabel: true,
			onChange: (value) => {
				this.state.rating = value;
				this.renderStars();
			},
		});
	}

	private renderTwoNumberRow(
		parent: HTMLElement,
		left: { label: string; value: number; onChange: (n: number) => void },
		right: { label: string; value: number; onChange: (n: number) => void },
	): void {
		const row = parent.createDiv({ cls: 'wl-reading-row wl-reading-row-split' });
		this.renderNumberCol(row, left);
		this.renderNumberCol(row, right);
	}

	private renderNumberCol(
		parent: HTMLElement,
		field: { label: string; value: number; onChange: (n: number) => void },
	): void {
		const col = parent.createDiv({ cls: 'wl-reading-col' });
		col.createSpan({ cls: 'wl-reading-label', text: field.label });
		const input = col.createEl('input', {
			cls: 'wl-modal-input wl-modal-input-sm',
			attr: { type: 'number', min: '0' },
		});
		input.value = String(field.value);
		input.addEventListener('input', () => {
			const n = parseInt(input.value, 10);
			field.onChange(isNaN(n) || n < 0 ? 0 : n);
		});
	}

	private renderDateField(
		parent: HTMLElement,
		label: string,
		value: string | null,
		onParsed: (parsed: string | null) => void,
	): void {
		const row = parent.createDiv({ cls: 'wl-reading-row' });
		row.createSpan({ cls: 'wl-reading-label', text: label });
		createDatePicker({
			parent: row,
			inputCls: 'wl-modal-input',
			value,
			onChange: onParsed,
		});
	}

	private renderFooter(parent: HTMLElement): void {
		const footer = parent.createDiv({ cls: 'wl-reading-modal-footer' });
		const cancelBtn = footer.createEl('button', { cls: 'wl-btn', text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = footer.createEl('button', {
			cls: 'wl-reading-add-btn wl-btn-success wl-reading-modal-save',
			text: this.saveButtonLabel(),
		});
		saveBtn.addEventListener('click', () => void this.save());
	}

	private saveButtonLabel(): string {
		if (this.existingId) return t('add.saveChanges');
		return this.mode === 'book' ? t('add.reading.addBook') : t('add.reading.addManga');
	}

	private async save(): Promise<void> {
		const title = this.state.title.trim();
		if (!title) {
			new Notice(t('add.reading.emptyTitle'));
			return;
		}

		if (this.mode === 'book') {
			await this.saveBook(title);
		} else {
			await this.saveManga(title);
		}
		this.onSaved();
		this.close();
	}

	private async saveBook(title: string): Promise<void> {
		if (this.existingId) {
			const existing = this.readingData.getBook(this.existingId);
			if (!existing) {
				new Notice(t('add.reading.bookGone'));
				return;
			}
			const updated: Book = {
				...existing,
				title,
				author: this.state.author.trim(),
				status: this.state.status,
				rating: this.state.rating,
				progressUnit: this.state.progressUnit,
				pagesRead: this.state.pagesRead,
				totalPages: this.state.totalPages,
				wordsRead: this.state.wordsRead,
				totalWords: this.state.totalWords,
				chaptersRead: this.state.chaptersRead,
				totalChapters: this.state.totalChapters,
				coverUrl: this.state.coverUrl.trim(),
				googleBooksId: this.state.googleBooksId.trim(),
				vaultPage: this.state.vaultPage,
				dateStarted: this.state.dateStarted,
				dateFinished: this.state.dateFinished,
				releaseDate: this.state.releaseDate,
			};
			await this.readingData.updateBook(updated);
		} else {
			const now = new Date().toISOString();
			const book: Book = {
				id: this.readingData.generateBookId(title),
				title,
				author: this.state.author.trim(),
				status: this.state.status,
				rating: this.state.rating,
				progressUnit: this.state.progressUnit,
				pagesRead: this.state.pagesRead,
				totalPages: this.state.totalPages,
				wordsRead: this.state.wordsRead,
				totalWords: this.state.totalWords,
				chaptersRead: this.state.chaptersRead,
				totalChapters: this.state.totalChapters,
				coverUrl: this.state.coverUrl.trim(),
				googleBooksId: this.state.googleBooksId.trim(),
				vaultPage: this.state.vaultPage,
				dateStarted: this.state.dateStarted,
				dateFinished: this.state.dateFinished,
				releaseDate: this.state.releaseDate,
				dateAdded: now,
				dateModified: now,
				customFields: {},
			};
			await this.readingData.addBook(book);
		}
	}

	private async saveManga(title: string): Promise<void> {
		if (this.existingId) {
			const existing = this.readingData.getManga(this.existingId);
			if (!existing) {
				new Notice(t('add.reading.mangaGone'));
				return;
			}
			const updated: Manga = {
				...existing,
				title,
				author: this.state.author.trim(),
				status: this.state.status,
				rating: this.state.rating,
				chaptersRead: this.state.chaptersRead,
				totalChapters: this.state.totalChapters,
				volumesRead: this.state.volumesRead,
				totalVolumes: this.state.totalVolumes,
				coverUrl: this.state.coverUrl.trim(),
				malId: this.state.malId.trim(),
				vaultPage: this.state.vaultPage,
				dateStarted: this.state.dateStarted,
				dateFinished: this.state.dateFinished,
				releaseDate: this.state.releaseDate,
			};
			await this.readingData.updateManga(updated);
		} else {
			const now = new Date().toISOString();
			const manga: Manga = {
				id: this.readingData.generateMangaId(title),
				title,
				author: this.state.author.trim(),
				status: this.state.status,
				rating: this.state.rating,
				chaptersRead: this.state.chaptersRead,
				totalChapters: this.state.totalChapters,
				volumesRead: this.state.volumesRead,
				totalVolumes: this.state.totalVolumes,
				coverUrl: this.state.coverUrl.trim(),
				malId: this.state.malId.trim(),
				vaultPage: this.state.vaultPage,
				dateStarted: this.state.dateStarted,
				dateFinished: this.state.dateFinished,
				releaseDate: this.state.releaseDate,
				dateAdded: now,
				dateModified: now,
				customFields: {},
			};
			await this.readingData.addManga(manga);
		}
	}
}

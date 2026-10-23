import { App, Notice } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { WatchLogTitle, WatchLogGroup, Season } from './types';
import { getApiGroupForType, todayIso } from './types';
import { renderSearchResultRow } from './SearchThumbnail';
import {
	episodesLabel,
	fillMediaFields,
	resolvePick,
	resultIdKeys,
	searchTitles,
	titlePickerBase,
	type TitlePick,
	type TitleSearchResult,
} from './titleSearch';
import { createSearchPicker, type SearchPicker } from './ui/SearchPicker';
import { SearchFormModal } from './ui/SearchFormModal';
import { LibraryIndex } from './LibraryIndex';
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

type SearchResult = TitleSearchResult;

export class AddTitleModal extends SearchFormModal {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	// gets the new entry — callers that don't care just ignore it
	private onAdded: (entry: WatchLogTitle) => void;

	private selectedType = 'Anime';
	private initialQuery = '';

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
		super(app, 'Add title', ['wl-add-modal']);
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
			if (prefill.searchQuery) this.initialQuery = prefill.searchQuery;
			this.media.episodes = prefill.episodes;
			this.media.duration = prefill.duration;
			this.media.releaseDate = prefill.releaseDate;
			this.media.link = prefill.link;
			this.fieldSeasons = prefill.seasons;
			if (prefill.trailerUrl !== undefined) this.fieldTrailerUrl = prefill.trailerUrl;
			if (prefill.director !== undefined) this.fieldDirector = prefill.director;
			if (prefill.cast !== undefined) this.fieldCast = prefill.cast;
		}
		this.picker = this.createPicker();
	}

	private createPicker(): SearchPicker {
		return createSearchPicker<SearchResult>({
			...titlePickerBase(this.plugin, this.selectedType, (v) => {
				this.selectedType = v;
				this.renderForm();
			}),
			grid: true,
			initialQuery: this.initialQuery,
			search: async (query, year) => (await searchTitles(this.plugin, this.selectedType, query, year)) ?? [],
			noApiMessage: () => this.noApiMessage(),
			renderResult: (host, result, select) => this.renderResult(host, result, select),
			onSelect: (result, isCurrent) => this.selectResult(result, isCurrent),
		});
	}

	private noApiMessage(): string | null {
		if (getApiGroupForType(this.selectedType, this.plugin.settings.typeApiMapping) !== '') return null;
		return `No API configured for type "${this.selectedType}". Go to Settings → API to set one up.`;
	}

	private renderResult(host: HTMLElement, result: SearchResult, select: (itemEl: HTMLElement) => void): HTMLElement {
		if (!this.libIndex) this.libIndex = LibraryIndex.build(this.plugin, ['watchlist']);
		const idKeys = resultIdKeys(result, this.plugin.settings.activeApi ?? 'OMDb');
		return renderSearchResultRow(host, {
			thumbUrl: result.posterUrl,
			fallbackIcon: '🎬',
			title: result.title,
			meta: `${episodesLabel(result)} · ${result.releaseDate}`,
			inLibrary: this.libIndex.lookup(idKeys, result.title),
			onClick: select,
		});
	}

	private async selectResult(result: SearchResult, isCurrent: () => boolean): Promise<void> {
		if (await resolvePick(this.plugin, result, isCurrent, (pick) => this.applyPick(pick))) this.renderForm();
	}

	private applyPick(pick: TitlePick): void {
		fillMediaFields(this.media, pick);
		this.fieldSeasons = pick.seasons;
		this.fieldTrailerUrl = pick.trailerUrl;
		this.fieldDirector = pick.director;
		this.fieldCast = pick.cast;
		this.fieldStudio = pick.studio;
		if (pick.animeIds) {
			this.fieldMalId = pick.animeIds.malId;
			this.fieldAnilistId = pick.animeIds.anilistId;
		}
	}

	protected renderForm(): void {
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

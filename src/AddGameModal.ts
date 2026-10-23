import { App, Notice, setIcon } from 'obsidian';
import type WatchLogPlugin from './main';
import type { GameDataManager } from './GameDataManager';
import { rawgResizedCover, steamAppIdFromUrl, type GameSearchResult } from './ApiService';
import { Game, GameGroup, GAME_AUTO_STATUS } from './types';
import { renderSearchResultRow } from './SearchThumbnail';
import { SearchFormModal, type SearchPickerOptions } from './ui/SearchFormModal';
import { LibraryIndex, gameResultIdKeys } from './LibraryIndex';
import { renderModePill } from './ModePill';
import { renderTagChips } from './StatusDropdown';
import { createDatePicker } from './DatePicker';
import { blockDuplicate, createDuplicateGuard } from './ui/DuplicateGuard';
import {
	linkField,
	makeCell,
	makeRow as makeFormRow,
	nameSelect,
	releaseDateField,
	renderGroupPicker,
	resetForm,
	textInput,
	titleField,
	type GroupPickerState,
} from './ui/FormCells';

/** Lowercased word tokens of a platform name, split into alpha and numeric. */
function platformTokens(name: string): { alpha: Set<string>; num: Set<string> } {
	const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	return {
		alpha: new Set(tokens.filter((t) => !/^\d+$/.test(t))),
		num: new Set(tokens.filter((t) => /^\d+$/.test(t))),
	};
}

/**
 * Loose platform-name equality across APIs: the smaller alpha-token set must be contained in the
 * larger ("PC" ⊂ "Windows PC" ⊂ "PC (Microsoft Windows)"), and numeric tokens (console
 * generations) must match exactly — so "PlayStation 5" never matches "PlayStation 4".
 */
function platformMatches(a: string, b: string): boolean {
	const ta = platformTokens(a);
	const tb = platformTokens(b);
	const [small, big] = ta.alpha.size <= tb.alpha.size ? [ta.alpha, tb.alpha] : [tb.alpha, ta.alpha];
	if (small.size === 0) return false;
	for (const t of small) if (!big.has(t)) return false;
	if (ta.num.size !== tb.num.size) return false;
	for (const n of ta.num) if (!tb.num.has(n)) return false;
	return true;
}

/** "2021 · PC, PS5": release year and up to three platforms. */
function gameResultMeta(result: GameSearchResult): string {
	const year = result.releaseDate.match(/^(\d{4})/)?.[1] ?? '—';
	const platforms = result.platforms.slice(0, 3).join(', ') || 'Unknown platforms';
	return `${year} · ${platforms}`;
}

/**
 * Add-game modal (the AddTitleModal pattern): API search (RAWG or IGDB per gamesApiSource) with
 * thumbnailed results, an editable form below, platform chips, the mode pill and a store-link
 * button. Works as a plain manual form when no API is configured.
 */
export class AddGameModal extends SearchFormModal<GameSearchResult> {
	private plugin: WatchLogPlugin;
	private gameData: GameDataManager;
	private onAdded: () => void;
	private initialQuery = '';

	private fieldTitle = '';
	private fieldDeveloper = '';
	private fieldPublisher = '';
	private fieldGenre = '';
	private fieldStatus = '';
	private fieldPriority = '';
	private fieldReleaseDate = '';
	private fieldDateStarted = '';
	private fieldStoreUrl = '';
	private fieldLink = '';
	private fieldCoverUrl = '';
	// cover last prefilled from an API result; unchanged it stays cache-only (not an override)
	private fieldPlatforms: string[] = [];
	// which API row the form was filled from — persisted on the game so covers can later be re-fetched
	// by id instead of by title
	private apiSource: '' | 'rawg' | 'igdb' = '';
	private apiId = '';
	private fieldSingleplayer = false;
	private fieldCoop = false;
	private fieldMultiplayer = false;
	private group: GroupPickerState = { selectedGroupId: '', newGroupName: '' };
	private duplicates = createDuplicateGuard();
	// built on first search, reused for the modal's life
	private libIndex: LibraryIndex | null = null;

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		gameData: GameDataManager,
		onAdded: () => void,
		prefill?: { searchQuery?: string; title?: string },
	) {
		super(app, 'Add game', ['wl-add-modal', 'wl-add-game-modal']);
		this.plugin = plugin;
		this.gameData = gameData;
		this.onAdded = onAdded;
		const s = gameData.getSettings();
		this.fieldGenre = s.types[0]?.name ?? '';
		this.fieldStatus = s.defaultStatus;
		// prefill (e.g. from Drafts): seed the search box and title field so the modal opens ready to search
		if (prefill?.title) this.fieldTitle = prefill.title;
		this.initialQuery = prefill?.searchQuery ?? '';
	}

	protected pickerOptions(): SearchPickerOptions<GameSearchResult> {
		return { placeholder: 'Search for a game...', grid: true, initialQuery: this.initialQuery };
	}

	protected noApiMessage(): string | null {
		const api = this.plugin.apiService;
		if (this.plugin.settings.gamesApiSource === 'igdb') {
			return api.hasIgdbCredentials()
				? null
				: 'No IGDB credentials configured. Go to Settings → API → Games to set the Twitch Client ID and Secret.';
		}
		return api.hasRawgKey() ? null : 'No RAWG API key configured. Go to Settings → API → Games to set one up.';
	}

	protected search(query: string): Promise<GameSearchResult[]> {
		const api = this.plugin.apiService;
		return this.plugin.settings.gamesApiSource === 'igdb' ? api.searchIgdbGames(query) : api.searchRawgGames(query);
	}

	protected renderResult(host: HTMLElement, result: GameSearchResult, select: (itemEl: HTMLElement) => void): HTMLElement {
		if (!this.libIndex) this.libIndex = LibraryIndex.build(this.plugin, ['games']);
		return renderSearchResultRow(host, {
			// card covers are full-width now, so request a sharper 600px rendition
			thumbUrl: rawgResizedCover(result.coverUrl, 600),
			fallbackIcon: '🎮',
			title: result.title,
			meta: gameResultMeta(result),
			inLibrary: this.libIndex.lookup(gameResultIdKeys(result), result.title),
			onClick: select,
		});
	}

	protected async selectResult(result: GameSearchResult, isCurrent: () => boolean): Promise<void> {
		const api = this.plugin.apiService;
		// remember the origin even if the detail fetch fails — the search row identifies the game well
		// enough to re-fetch its cover later
		this.apiSource = result.source;
		this.apiId = String(result.id);
		try {
			const full = result.source === 'igdb'
				? await api.getIgdbGameDetails(result.id)
				: await api.getRawgGameDetails(result.id);
			if (!isCurrent()) return;
			if (full) {
				this.fieldTitle = full.title;
				this.fieldDeveloper = full.developer;
				this.fieldPublisher = full.publisher;
				this.fieldReleaseDate = full.releaseDate;
				this.fieldCoverUrl = full.coverUrl;
				this.fieldLink = full.url;
				this.fieldStoreUrl = full.storeUrl;
				this.fieldSingleplayer = full.singleplayer;
				this.fieldCoop = full.coop;
				this.fieldMultiplayer = full.multiplayer;
				this.fieldPlatforms = this.matchOwnPlatforms(full.platforms);
			}
		} catch {
			// detail fetch failed — fall back to what the search row carried
			this.fieldTitle = result.title;
			this.fieldReleaseDate = result.releaseDate;
			this.fieldCoverUrl = result.coverUrl;
			this.fieldLink = result.url;
			this.fieldPlatforms = this.matchOwnPlatforms(result.platforms);
		}

		this.renderForm();
	}

	/** Maps API platform names onto the user's configured platform chips. */
	private matchOwnPlatforms(apiPlatforms: string[]): string[] {
		return this.gameData
			.getSettings()
			.platforms.filter((own) => apiPlatforms.some((p) => platformMatches(own.name, p)))
			.map((own) => own.name);
	}

	protected renderForm(): void {
		const form = resetForm(this.formEl);
		if (!form) return;
		const makeRow = (label: string): HTMLElement => makeFormRow(form, label);

		titleField(form, this.fieldTitle, 'Game title', (v) => { this.fieldTitle = v; });

		const devPubRow = form.createDiv({ cls: 'wl-modal-row wl-modal-row-pair' });
		textInput(makeCell(devPubRow, 'Developer'), {
			value: this.fieldDeveloper,
			placeholder: 'Developer',
			onInput: (v) => { this.fieldDeveloper = v; },
		});
		textInput(makeCell(devPubRow, 'Publisher', true), {
			value: this.fieldPublisher,
			placeholder: 'Publisher',
			onInput: (v) => { this.fieldPublisher = v; },
		});

		const settings = this.gameData.getSettings();
		const genrePriRow = form.createDiv({ cls: 'wl-modal-row wl-modal-row-pair' });
		nameSelect(makeCell(genrePriRow, 'Genre'), settings.types.map((t) => t.name), this.fieldGenre,
			(v) => { this.fieldGenre = v; });
		nameSelect(makeCell(genrePriRow, 'Priority', true), this.plugin.settings.priorities.map((p) => p.name),
			this.fieldPriority, (v) => { this.fieldPriority = v; }, true);

		// status + date started paired 50/50 (the auto "To be released" is excluded — it follows the
		// release date)
		const statusStartRow = form.createDiv({ cls: 'wl-modal-row wl-modal-row-pair' });
		const statuses = settings.statuses.filter((s) => s.name !== GAME_AUTO_STATUS);
		nameSelect(makeCell(statusStartRow, 'Status'), statuses.map((s) => s.name), this.fieldStatus,
			(v) => { this.fieldStatus = v; });

		const startCell = makeCell(statusStartRow, 'Date started', true);
		createDatePicker({
			parent: startCell,
			inputCls: 'wl-modal-input',
			value: this.fieldDateStarted || null,
			onChange: (iso) => { this.fieldDateStarted = iso ?? ''; },
		});

		releaseDateField(form, this.fieldReleaseDate, (v) => { this.fieldReleaseDate = v; });

		const storeRow = makeRow('Store link');
		const storeInput = storeRow.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'url', placeholder: 'https://store.steampowered.com/...' },
		});
		storeInput.value = this.fieldStoreUrl;
		const storeBtn = storeRow.createEl('button', {
			cls: 'wl-store-btn',
			attr: { type: 'button', title: 'Open store page', 'aria-label': 'Open store page' },
		});
		setIcon(storeBtn, 'store');
		const syncStoreBtn = (): void => {
			storeBtn.toggleClass('wl-hidden', !this.fieldStoreUrl.trim());
		};
		syncStoreBtn();
		storeInput.addEventListener('input', () => {
			this.fieldStoreUrl = storeInput.value;
			syncStoreBtn();
		});
		storeBtn.addEventListener('click', () => {
			const url = this.fieldStoreUrl.trim();
			if (url) window.open(url, '_blank');
		});

		linkField(form, this.fieldLink, 'https://example.com', (v) => { this.fieldLink = v; });

		textInput(makeRow('Cover URL'), {
			value: this.fieldCoverUrl,
			type: 'url',
			placeholder: 'https://…',
			onInput: (v) => { this.fieldCoverUrl = v; },
		});

		const modesRow = makeRow('Modes');
		renderModePill(
			modesRow,
			() => ({
				singleplayer: this.fieldSingleplayer,
				coop: this.fieldCoop,
				multiplayer: this.fieldMultiplayer,
			}),
			(patch) => {
				if (patch.singleplayer !== undefined) this.fieldSingleplayer = patch.singleplayer;
				if (patch.coop !== undefined) this.fieldCoop = patch.coop;
				if (patch.multiplayer !== undefined) this.fieldMultiplayer = patch.multiplayer;
			},
		);

		// platforms — the shared coloured toggle chips, driven by Settings → Customize → Games
		const platRow = makeRow('Platforms');
		renderTagChips({
			wrap: platRow.createDiv({ cls: 'wl-game-modal-platforms wl-add-game-platforms' }),
			tags: settings.platforms,
			selected: this.fieldPlatforms,
			onToggle: (sel) => { this.fieldPlatforms = sel; },
		});

		// group fields (mutually exclusive, the AddTitleModal pattern)
		renderGroupPicker(form, this.gameData.getGroups(), this.group);

		const btnRow = form.createDiv({ cls: 'wl-modal-btn-row' });
		const addBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Add to games' });
		addBtn.addEventListener('click', () => void this.addGame());
	}

	private async addGame(): Promise<void> {
		const titleName = this.fieldTitle.trim();
		if (!titleName) {
			new Notice('Please enter a game title.');
			return;
		}

		const isDuplicate = this.gameData.getGames().some(
			(g) => g.title.toLowerCase() === titleName.toLowerCase(),
		);
		const blocked = blockDuplicate(this.contentEl, this.duplicates, {
			name: titleName,
			isDuplicate,
			verb: 'Add',
			retry: () => void this.addGame(),
		});
		if (blocked) return;

		const now = new Date().toISOString();
		const game: Game = {
			id: this.gameData.generateGameId(titleName),
			title: titleName,
			developer: this.fieldDeveloper.trim(),
			publisher: this.fieldPublisher.trim(),
			type: this.fieldGenre,
			status: this.fieldStatus,
			priority: this.fieldPriority,
			favorite: false,
			wishlist: false,
			rating: 0,
			progress: 0,
			playtimeMinutes: 0,
			achievementsEarned: 0,
			achievementsTotal: 0,
			platforms: [...this.fieldPlatforms],
			singleplayer: this.fieldSingleplayer,
			coop: this.fieldCoop,
			multiplayer: this.fieldMultiplayer,
			coverUrl: this.fieldCoverUrl.trim(),
			apiSource: this.apiSource,
			apiId: this.apiId,
			// seeded from the store link when it's a Steam page, so a later Steam sync matches exactly instead
			// of guessing by title
			steamAppId: steamAppIdFromUrl(this.fieldStoreUrl.trim()),
			lastPlayed: null,
			storeUrl: this.fieldStoreUrl.trim(),
			externalLink: this.fieldLink.trim(),
			vaultPage: '',
			releaseDate: this.fieldReleaseDate || null,
			dateStarted: this.fieldDateStarted || null,
			dateFinished: null,
			dateAdded: now,
			dateModified: now,
		};

		await this.gameData.addGame(game);

		if (this.group.selectedGroupId) {
			await this.gameData.addGameToGroup(this.group.selectedGroupId, game.id);
		} else if (this.group.newGroupName.trim()) {
			const name = this.group.newGroupName.trim();
			const group: GameGroup = {
				id: this.gameData.generateGroupId(name),
				name,
				gameIds: [game.id],
				dateAdded: new Date().toISOString(),
			};
			await this.gameData.addGroup(group);
		}

		new Notice(`"${titleName}" added to WatchLog.`);
		this.close();
		this.onAdded();
	}
}

import { App, Notice, Platform, PluginSettingTab, Setting, SliderComponent, normalizePath, setIcon } from 'obsidian';
import { t, type TranslationKey } from './i18n';
import { statusLabel, typeLabel, readingStatusLabel } from './i18n/labels';
import { createIconButton } from './ui/IconButton';
import { typeNameProblemText } from './ui/problemText';
import { cardSizeToMinWidth } from './VirtualGrid';
import type WatchLogPlugin from './main';
import type { TagDefinition, ReadingStatus, GamesSettings, DateFormatPref, CardStyleTab, CardTextStyle } from './types';
import { SELECTABLE_READING_STATUSES, READING_STATUSES, LAST_USED_TYPE_SENTINEL, formatDateDisplay, needsStudioFetch, getApiGroupForType, isCreditsNone, CREDITS_NONE } from './types';
import { readingStatusColor } from './readingColors';
import { SteamSyncModal } from './SteamSyncModal';
import type { SteamFailureReason } from './ApiService';

/** short status-line label per Steam failure (the modal shows the long form) */
function steamFailureLabel(reason: SteamFailureReason): string {
	switch (reason) {
		case 'missing': return t('settings.steam.missing');
		case 'badKey': return t('settings.steam.badKey');
		case 'private': return t('settings.steam.private');
		case 'empty': return t('settings.steam.empty');
		default: return t('settings.steam.unreachable');
	}
}

/** sample date behind the Date-format preview labels */
const DATE_PREVIEW = '2026-03-09';

/** donation link behind the header coffee button */
const BMC_URL = 'https://buymeacoffee.com/bogdanyo17i';

/**
 * Accessors for one colour-list section in Customize. Omitting add/remove/rename hides
 * that control — how colour-only sections are expressed.
 */
interface TagListSectionConfig {
	label: string;
	info?: string;
	getList: () => TagDefinition[];
	setColor: (name: string, color: string) => Promise<void>;
	/** entries that keep the colour picker but can't be renamed or removed */
	isLocked?: (name: string) => boolean;
	add?: (name: string, color: string) => Promise<void>;
	/** returns a message when the name is unusable (shown instead of adding or renaming) */
	validateName?: (name: string) => string | null;
	remove?: (name: string) => Promise<void>;
	/** present ⇒ the name becomes an editable input; must cascade the rename */
	rename?: (from: string, to: string) => Promise<void>;
	/** display text for a stored name in read-only pills; the stored name itself never changes */
	display?: (name: string) => string;
	/** called after every add/remove/rename — lets the group header chip re-count */
	onChanged?: () => void;
}

/**
 * Colour of a status chip in a group header or provider card. `count` is the dotless
 * neutral used for "6 types" read-outs.
 */
type ChipTone = 'ok' | 'warn' | 'error' | 'idle' | 'pending' | 'count';

/**
 * Accent palettes for `settingsGroup` — one per library, plus the neutrals and the
 * cross-tab utility accents (csv, folders, subfolders, backup), which keep the same
 * meaning on every page.
 */
type SettingsGroupVariant =
	| 'movies' | 'anime' | 'books' | 'games'
	| 'watchlist' | 'reading' | 'theme' | 'shared' | 'cards'
	| 'general' | 'drafts' | 'lists'
	| 'csv' | 'folders' | 'subfolders' | 'backup';

interface ChipStatus {
	text: string;
	tone: ChipTone;
	/** Full explanation, rendered under the card — the chip itself is too small for one. */
	detail?: string;
}

/** One credential input inside a provider card. */
interface ApiProviderField {
	label: string;
	placeholder: string;
	/** Rendered as a password field with a reveal toggle. */
	secret?: boolean;
	get: () => string;
	set: (v: string) => void;
	/** Handed the input element so a Test handler can write a resolved value back. */
	onInput?: (el: HTMLInputElement) => void;
}

/** One API provider card (OMDb, TMDB, RAWG, …). Keyless providers omit `fields` and `test`. */
interface ApiProviderSpec {
	name: string;
	/** Letter shown in the avatar disc. */
	initials: string;
	/** One-line subtitle under the name. */
	note?: string;
	/** Fixed label in the top-right slot, for cards outside an active/inactive pair. */
	badge?: string;
	fields?: ApiProviderField[];
	link?: { text: string; href: string };
	/** Long-form guidance, folded behind the (?) button. */
	help?: string;
	/** Status shown before any Test, recomputed on every keystroke. */
	status: () => ChipStatus;
	test?: () => Promise<ChipStatus>;
	/** Extra content below the footer (Steam's Sync button). */
	extra?: (el: HTMLElement) => void;
}

interface ApiProviderHandle {
	/** `null` leaves the card neutral — it isn't part of an active/inactive pair. */
	setActive: (active: boolean | null) => void;
	refreshStatus: () => void;
}
import { CsvModal } from './CsvModal';
import { ReadingCsvChoiceModal } from './ReadingCsvChoiceModal';
import { ReadingCsvModal } from './ReadingCsvModal';
import { WatchLogView } from './WatchLogView';
import { CustomListManager, DefaultColumnsModal } from './CustomListsTab';
import { ConfirmModal } from './ConfirmModal';
import { refreshAllCovers } from './coverRefresh';
import { apiErrorMessage, apiErrorShort } from './ApiService';
import { TENRAI_BASE, parseJikanEndpoint, resolveJikanEndpoint } from './jikanBase';
import { buildBackup, parseBackup, restoreBackup, restoreLegacyBackup, withoutSecrets } from './backup';

/** Chip for the MyAnimeList endpoint field: default, custom, or rejected and falling back. */
function jikanEndpointStatus(raw: string): ChipStatus {
	const parsed = parseJikanEndpoint(raw);
	if (parsed && parsed.base !== TENRAI_BASE) return { text: t('settings.api.jikan.custom'), tone: 'ok' };
	if (parsed || raw.trim() === '') return { text: t('settings.api.jikan.default'), tone: 'ok' };
	return { text: t('settings.api.jikan.invalid'), tone: 'warn' };
}

type SettingsSection = 'general' | 'api' | 'customize' | 'watchlist' | 'drafts' | 'custom-lists' | 'reading' | 'widgets' | 'quick-info';

export class WatchLogSettingsTab extends PluginSettingTab {
	private plugin: WatchLogPlugin;
	private textSaveTimer: number | null = null;

	private debouncedSaveSettings(): void {
		if (this.textSaveTimer !== null) window.clearTimeout(this.textSaveTimer);
		this.textSaveTimer = window.setTimeout(() => {
			this.textSaveTimer = null;
			void this.plugin.saveSettings();
		}, 500);
	}
	private activeSection: SettingsSection = 'general';
	/** Teardown for an in-flight restore file picker; see openRestoreDialog. */
	private restoreDialogCleanup: (() => void) | null = null;

	constructor(app: App, plugin: WatchLogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		// a file picker left open when the settings pane closes would otherwise strand its hidden
		// <input> in the document body along with the window focus listener watching it
		this.restoreDialogCleanup?.();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('wl-settings');

		// mobile/tablet: 9 text labels overflow the pane — icon-only nav (same icons as the view tabs)
		const iconOnly = Platform.isMobile;
		containerEl.toggleClass('wl-settings-mobile', iconOnly);

		const nav = containerEl.createDiv({ cls: 'wl-settings-nav' });
		const sections: { key: SettingsSection; label: string; icon: string }[] = [
			{ key: 'general', label: t('settings.nav.general'), icon: 'settings' },
			{ key: 'api', label: t('settings.nav.api'), icon: 'plug' },
			{ key: 'customize', label: t('settings.nav.customize'), icon: 'palette' },
			{ key: 'watchlist', label: t('settings.nav.watchlist'), icon: 'tv' },
			{ key: 'drafts', label: t('settings.nav.drafts'), icon: 'square-pen' },
			{ key: 'custom-lists', label: t('settings.nav.customLists'), icon: 'list' },
			{ key: 'reading', label: t('settings.nav.reading'), icon: 'book-open' },
			{ key: 'widgets', label: t('settings.nav.widgets'), icon: 'layout-grid' },
			{ key: 'quick-info', label: t('settings.nav.quickInfo'), icon: 'help-circle' },
		];

		const buttons: Map<SettingsSection, HTMLButtonElement> = new Map();
		for (const sec of sections) {
			const btn = nav.createEl('button', {
				cls: `wl-settings-nav-btn${this.activeSection === sec.key ? ' is-active' : ''}`,
			});
			if (iconOnly) {
				btn.addClass('wl-settings-nav-btn-icon');
				setIcon(btn, sec.icon);
				btn.setAttribute('aria-label', sec.label);
			} else {
				btn.setText(sec.label);
			}
			buttons.set(sec.key, btn);
			btn.addEventListener('click', () => {
				this.activeSection = sec.key;
				buttons.forEach((b, k) => {
					if (k === sec.key) { b.addClass('is-active'); } else { b.removeClass('is-active'); }
				});
				body.empty();
				this.renderSection(body);
			});
		}

		const body = containerEl.createDiv({ cls: 'wl-settings-body' });
		this.renderSection(body);
	}

	private renderSection(body: HTMLElement): void {
		body.empty();
		switch (this.activeSection) {
			case 'general': this.renderGeneral(body); break;
			case 'api': this.renderApi(body); break;
			case 'customize': this.renderCustomize(body); break;
			case 'watchlist': this.renderWatchlist(body); break;
			case 'drafts': this.renderDrafts(body); break;
			case 'custom-lists': this.renderCustomLists(body); break;
			case 'reading': this.renderReading(body); break;
			case 'widgets': this.renderWidgets(body); break;
			case 'quick-info': this.renderQuickInfo(body); break;
		}
	}

	// General

	/** Slider steps -3…3 in order. */
	private static readonly CARD_SIZE_KEYS = [
		'settings.cardSize.smallest', 'settings.cardSize.smaller', 'settings.cardSize.small',
		'settings.cardSize.default', 'settings.cardSize.large', 'settings.cardSize.larger',
		'settings.cardSize.largest',
	] as const;

	/** Tabs listed in the Card-text per-tab rows, in display order. */
	private static readonly CARD_STYLE_TABS: Array<{ key: CardStyleTab; label: TranslationKey; icon: string }> = [
		{ key: 'watchlist', label: 'app.tabs.watchlist', icon: 'clapperboard' },
		{ key: 'games', label: 'app.tabs.games', icon: 'gamepad-2' },
		{ key: 'reading', label: 'app.tabs.reading', icon: 'book-open' },
		{ key: 'upcoming', label: 'app.tabs.upcoming', icon: 'calendar-clock' },
	];

	/**
	 * The Customize → Cards body: the per-tab text-placement picker (mini previews as
	 * apply-to-all shortcuts + one Under/Inside row per tab) and the size sliders.
	 * `setChip` keeps the header chip in sync ("Text under · 160 px", "Mixed · 160 px").
	 */
	private renderCardSettings(el: HTMLElement, setChip: (label: string) => void): void {
		const s = this.plugin.settings;
		const tabs = WatchLogSettingsTab.CARD_STYLE_TABS;
		/** 'under' / 'inside' when every tab agrees, null when mixed. */
		const unanimous = (): CardTextStyle | null => {
			const first = s.cardTextStyles[tabs[0]!.key];
			return tabs.every((tab) => s.cardTextStyles[tab.key] === first) ? first : null;
		};
		const syncChip = (): void => {
			const all = unanimous();
			const style = all === null
				? t('settings.cards.styleMixed')
				: all === 'inside' ? t('settings.cards.textInside') : t('settings.cards.textUnder');
			setChip(t('settings.cards.valuePx', { label: style, px: cardSizeToMinWidth(s.cardSize ?? 0) }));
		};

		// text placement
		const styleBody = this.sgCard(el, {
			label: t('settings.cards.text.label'),
			help: t('settings.cards.text.help'),
		});
		const picker = styleBody.createDiv({ cls: 'wl-card-style-picker' });
		const options: Array<{ value: CardTextStyle; name: string; hint: string }> = [
			{ value: 'under', name: t('settings.cards.textUnder'), hint: t('settings.cards.hintUnder') },
			{ value: 'inside', name: t('settings.cards.textInside'), hint: t('settings.cards.hintInside') },
		];
		const tiles = new Map<CardTextStyle, HTMLElement>();
		const tabButtons: Array<{ key: CardStyleTab; value: CardTextStyle; btn: HTMLElement }> = [];
		// one save path for tiles and rows: persist, repaint open tabs, resync UI
		const applyStyles = (assign: Partial<Record<CardStyleTab, CardTextStyle>>): void => {
			Object.assign(s.cardTextStyles, assign);
			const all = unanimous();
			for (const [value, tile] of tiles) tile.toggleClass('is-active', value === all);
			for (const { key, value, btn } of tabButtons) {
				btn.toggleClass('is-active', s.cardTextStyles[key] === value);
			}
			syncChip();
			void (async () => {
				await this.plugin.saveSettings();
				this.plugin.dataManager.notifyChange();
			})();
		};

		for (const opt of options) {
			const btn = picker.createEl('button', { cls: 'wl-card-style-option' });
			btn.setAttr('aria-label', t('settings.cards.applyAll', { name: opt.name }));
			tiles.set(opt.value, btn);
			// mini preview: a poster rectangle with two text lines below it or in a scrim
			const thumb = btn.createDiv({ cls: `wl-card-style-thumb is-${opt.value}` });
			const poster = thumb.createDiv({ cls: 'wl-card-style-thumb-poster' });
			const lines = (opt.value === 'inside' ? poster : thumb)
				.createDiv({ cls: 'wl-card-style-thumb-lines' });
			lines.createDiv({ cls: 'wl-card-style-thumb-line' });
			lines.createDiv({ cls: 'wl-card-style-thumb-line is-short' });
			btn.createDiv({ cls: 'wl-card-style-name', text: opt.name });
			btn.createDiv({ cls: 'wl-card-style-hint', text: opt.hint });
			if (unanimous() === opt.value) btn.addClass('is-active');
			btn.addEventListener('click', () => {
				// typed record, not Object.fromEntries — that returns `any`
				const all: Partial<Record<CardStyleTab, CardTextStyle>> = {};
				for (const tab of tabs) all[tab.key] = opt.value;
				applyStyles(all);
			});
		}

		// per-tab rows: icon · tab name · [Under | Inside]
		const tabRows = styleBody.createDiv({ cls: 'wl-card-style-tabs' });
		for (const tab of tabs) {
			const row = tabRows.createDiv({ cls: 'wl-card-style-tab-row' });
			const iconEl = row.createSpan({ cls: 'wl-card-style-tab-icon' });
			setIcon(iconEl, tab.icon);
			row.createSpan({ cls: 'wl-card-style-tab-label', text: t(tab.label) });
			const group = row.createDiv({ cls: 'wl-card-style-tab-group' });
			for (const opt of options) {
				const btn = group.createEl('button', {
					cls: 'wl-card-style-tab-btn',
					text: opt.value === 'under' ? t('settings.cards.under') : t('settings.cards.inside'),
				});
				btn.setAttr('aria-label', t('settings.cards.tabStyle', { tab: t(tab.label), style: opt.name.toLowerCase() }));
				if (s.cardTextStyles[tab.key] === opt.value) btn.addClass('is-active');
				tabButtons.push({ key: tab.key, value: opt.value, btn });
				btn.addEventListener('click', () => {
					if (s.cardTextStyles[tab.key] === opt.value) return;
					applyStyles({ [tab.key]: opt.value });
				});
			}
		}

		// size
		const sizeBody = this.sgCard(el, {
			label: t('settings.cards.size.label'),
			help: t('settings.cards.size.help'),
		});
		const rows = sizeBody.createDiv({ cls: 'wl-card-size-rows' });
		this.renderCardSizeRow(rows, 'monitor', t('settings.cards.desktop'),
			() => s.cardSize ?? 0, (v) => { s.cardSize = v; }, syncChip);
		this.renderCardSizeRow(rows, 'smartphone', t('settings.cards.mobile'),
			() => s.cardSizeMobile ?? 0, (v) => { s.cardSizeMobile = v; }, syncChip);

		syncChip();
	}

	/**
	 * One card-size slider row (icon · label · slider · live value); applied to the CSS var
	 * and any open view immediately.
	 */
	private renderCardSizeRow(
		parent: HTMLElement,
		icon: string,
		label: string,
		get: () => number,
		set: (v: number) => void,
		onChanged: () => void,
	): void {
		const row = parent.createDiv({ cls: 'wl-card-size-row' });
		const iconEl = row.createSpan({ cls: 'wl-card-size-row-icon' });
		setIcon(iconEl, icon);
		row.createSpan({ cls: 'wl-card-size-row-label', text: label });

		const fmt = (v: number): string => t('settings.cards.valuePx', {
			label: t(WatchLogSettingsTab.CARD_SIZE_KEYS[v + 3] ?? 'settings.cardSize.default'),
			px: cardSizeToMinWidth(v),
		});
		const slider = new SliderComponent(row);
		const valueEl = row.createSpan({ cls: 'wl-card-size-value', text: fmt(get()) });
		slider
			.setLimits(-3, 3, 1)
			.setValue(get())
			.onChange(async (v) => {
				set(v);
				valueEl.setText(fmt(v));
				await this.plugin.saveSettings();
				// re-publish the CSS var and re-render, so the size shows now and not on tab switch
				this.plugin.applyCardSizeCssVar();
				this.plugin.dataManager.notifyChange();
				onChanged();
			});
	}

	/** Buy Me a Coffee link, parked at the tail of a group header. */
	private renderCoffeeButton(head: HTMLElement): void {
		const link = head.createEl('a', {
			cls: 'wl-bmc-btn',
			href: BMC_URL,
			attr: { target: '_blank', rel: 'noopener' },
		});
		const icon = link.createSpan({ cls: 'wl-bmc-icon' });
		setIcon(icon, 'coffee');
		link.createSpan({ cls: 'wl-bmc-text', text: t('settings.general.coffee') });
	}

	private renderGeneral(container: HTMLElement): void {
		const page = container.createDiv({ cls: 'wl-sg-page' });

		// main
		const mainGroup = this.settingsGroup(page, {
			title: t('settings.group.main'),
			sub: t('settings.general.main.sub'),
			icon: 'sliders-horizontal',
			variant: 'general',
			rows: true,
		});
		const el = mainGroup.body;

		this.renderCoffeeButton(mainGroup.head);

		new Setting(el)
			.setName(t('settings.general.dashboardStyle.name'))
			.setDesc(t('settings.general.dashboardStyle.desc'))
			.addDropdown((d) =>
				d
					.addOptions({
						circles: t('settings.general.dashboardStyle.circles'),
						rectangles: t('settings.general.dashboardStyle.rectangles'),
					})
					.setValue(this.plugin.settings.dashboardCardStyle ?? 'circles')
					.onChange(async (v) => {
						this.plugin.settings.dashboardCardStyle = v as 'circles' | 'rectangles';
						await this.plugin.saveSettings();
						activeDocument.dispatchEvent(new CustomEvent('watchlog-data-changed'));
					}),
			);

		new Setting(el)
			.setName(t('settings.general.dateFormat.name'))
			.setDesc(t('settings.general.dateFormat.desc'))
			.addDropdown((d) =>
				d
					.addOptions({
						european: t('settings.general.dateFormat.european', { date: formatDateDisplay(DATE_PREVIEW, 'european') }),
						american: t('settings.general.dateFormat.american', { date: formatDateDisplay(DATE_PREVIEW, 'american') }),
						iso: t('settings.general.dateFormat.iso', { date: formatDateDisplay(DATE_PREVIEW, 'iso') }),
					})
					.setValue(this.plugin.settings.dateFormat ?? 'european')
					.onChange(async (v) => {
						this.plugin.settings.dateFormat = v as DateFormatPref;
						// saveSettings mirrors the value into the shared formatters
						await this.plugin.saveSettings();
						// repaint open tabs and widgets so the new order shows immediately
						this.refreshOpenViews();
					}),
			);

		new Setting(el)
			.setName(t('settings.general.halfStar.name'))
			.setDesc(t('settings.general.halfStar.desc'))
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.halfStarRatings ?? false)
					.onChange(async (v) => {
						this.plugin.settings.halfStarRatings = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(el)
			.setName(t('settings.general.finishDate.name'))
			.setDesc(t('settings.general.finishDate.desc'))
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.setFinishDateAutomatically)
					.onChange(async (v) => {
						this.plugin.settings.setFinishDateAutomatically = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(el)
			.setName(t('settings.general.replaceImages.name'))
			.setDesc(t('settings.general.replaceImages.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.general.replaceImages.button')).onClick(() => {
					const titles = this.plugin.dataManager.getTitles();
					const readingCount = this.plugin.readingDataManager.getBooks().length + this.plugin.readingDataManager.getMangaList().length;
					const gameCount = this.plugin.gameDataManager.getGames().length;
					new ConfirmModal(
						this.app,
						t('settings.general.replaceImages.confirm', { titles: titles.length, reading: readingCount, games: gameCount }),
						() => { void this.refetchAllPosters(); },
					).open();
				}),
			);

		new Setting(el)
			.setName(t('settings.general.rewrite.name'))
			.setDesc(t('settings.general.rewrite.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.general.rewrite.button')).onClick(() => {
					const titles = this.plugin.dataManager.getTitles();
					const readingCount = this.plugin.readingDataManager.getBooks().length + this.plugin.readingDataManager.getMangaList().length;
					new ConfirmModal(
						this.app,
						t('settings.general.rewrite.confirm', { titles: titles.length, reading: readingCount }),
						() => { void this.rewriteAllFrontmatter(); },
					).open();
				}),
			);

		new Setting(el)
			.setName(t('settings.general.studios.name'))
			.setDesc(t('settings.general.studios.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.general.studios.button')).onClick(() => {
					const pending = this.plugin.dataManager
						.getTitles()
						.filter((title) => needsStudioFetch(title)).length;
					if (pending === 0) {
						new Notice(t('settings.general.studios.allHave'));
						return;
					}
					new ConfirmModal(
						this.app,
						t('settings.general.studios.confirm', { count: pending }),
						() => { void this.fetchAllStudios(); },
					).open();
				}),
			);

		new Setting(el)
			.setName(t('settings.general.hints.name'))
			.setDesc(t('settings.general.hints.desc'))
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.showHintBanners)
					.onChange(async (v) => {
						this.plugin.settings.showHintBanners = v;
						await this.plugin.saveSettings();
						activeDocument.dispatchEvent(new CustomEvent('watchlog-data-changed'));
					}),
			);

		new Setting(el)
			.setName(t('settings.general.statusBar.name'))
			.setDesc(t('settings.general.statusBar.desc'))
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.showUpcomingStatusBar)
					.onChange(async (v) => {
						this.plugin.settings.showUpcomingStatusBar = v;
						await this.plugin.saveSettings();
						this.plugin.updateStatusBar();
					}),
			);

		// Backup & restore
		const bk = this.settingsGroup(page, {
			title: t('settings.backup.title'),
			sub: t('settings.backup.sub'),
			icon: 'database-backup',
			variant: 'backup',
			rows: true,
		}).body;

		new Setting(bk)
			.setName(t('settings.backup.export.name'))
			.setDesc(t('settings.backup.export.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.backup.export.button')).onClick(() => void this.exportBackup()),
			);

		new Setting(bk)
			.setName(t('settings.backup.restore.name'))
			.setDesc(t('settings.backup.restore.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.backup.restore.button')).onClick(() => this.openRestoreDialog()),
			);

		const regenHolder = {
			wrap: null as HTMLElement | null,
			fill: null as HTMLElement | null,
			text: null as HTMLElement | null,
		};

		new Setting(bk)
			.setName(t('settings.backup.regenerate.name'))
			.setDesc(t('settings.backup.regenerate.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.backup.regenerate.button')).onClick(() => {
					const { wrap, fill, text } = regenHolder;
					if (wrap && fill && text) void this.runRegenerate(wrap, fill, text);
				}),
			);

		const regenProgressWrap = bk.createDiv({ cls: 'wl-regen-progress-wrap' });
		regenProgressWrap.hide();
		regenProgressWrap.createSpan({ cls: 'wl-csv-bg-note', text: t('settings.backup.regenerate.note') });
		const regenProgressTrack = regenProgressWrap.createDiv({ cls: 'wl-csv-progress-track' });
		const regenProgressFill = regenProgressTrack.createDiv({ cls: 'wl-csv-progress-fill' });
		const regenProgressText = regenProgressWrap.createSpan({ cls: 'wl-csv-progress-text', text: '0 / 0' });

		regenHolder.wrap = regenProgressWrap;
		regenHolder.fill = regenProgressFill;
		regenHolder.text = regenProgressText;
	}

	private async exportBackup(): Promise<void> {
		const today = new Date();
		const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
		const filename = `watchlog-backup-${dateStr}.json`;

		// notes, shared settings, log and the device-local settings including API keys (E7): keep the file private
		const backup = buildBackup(this.plugin.backupManagers());

		// on mobile a browser download lands in an inaccessible sandbox — write into the vault
		// instead, without the API keys (the folder syncs); desktop keeps the download path
		if (Platform.isMobile) {
			await this.exportBackupToVault(filename, JSON.stringify(withoutSecrets(backup), null, 2));
			return;
		}
		const json = JSON.stringify(backup, null, 2);

		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = createEl('a');
		a.href = url;
		a.download = filename;
		activeDocument.body.appendChild(a);
		a.click();
		activeDocument.body.removeChild(a);
		URL.revokeObjectURL(url);
		new Notice(t('settings.backup.export.done', { filename }));
	}

	/** Mobile path: write the backup into <root>/backups/, disambiguating on collision. */
	private async exportBackupToVault(filename: string, json: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const folder = normalizePath(`${this.plugin.getLayout().root}/backups`);
		if (!(await adapter.exists(folder))) {
			try {
				await adapter.mkdir(folder);
			} catch {
				// folder may already exist
			}
		}

		// the reading-id slug rule: base name, then -2, -3, … on collision
		const dotIndex = filename.lastIndexOf('.');
		const base = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
		const ext = dotIndex === -1 ? '' : filename.slice(dotIndex);
		let path = normalizePath(`${folder}/${filename}`);
		if (await adapter.exists(path)) {
			let counter = 2;
			while (await adapter.exists(normalizePath(`${folder}/${base}-${counter}${ext}`))) counter++;
			path = normalizePath(`${folder}/${base}-${counter}${ext}`);
		}

		await adapter.write(path, json);
		new Notice(t('settings.backup.export.savedToVault', { path }));
	}

	private openRestoreDialog(): void {
		// a previous picker still hanging around (rapid double-click) is torn down first
		this.restoreDialogCleanup?.();

		const input = activeDocument.body.createEl('input', { attr: { type: 'file', accept: '.json' } });
		input.hide();
		let consumed = false;
		// one teardown for every exit path — file chosen, picker cancelled, or the settings pane
		// closing underneath it (hide() calls this through restoreDialogCleanup)
		const cleanupInput = (): void => {
			window.removeEventListener('focus', onFocus);
			input.remove();
			if (this.restoreDialogCleanup === cleanupInput) this.restoreDialogCleanup = null;
		};
		// a cancelled picker returns focus to window; clean up shortly after
		const onFocus = (): void => {
			window.setTimeout(() => {
				if (!consumed) cleanupInput();
			}, 200);
		};
		window.addEventListener('focus', onFocus);
		this.restoreDialogCleanup = cleanupInput;
		input.addEventListener('change', () => {
			consumed = true;
			const file = input.files?.[0];
			if (!file) { cleanupInput(); return; }
			const reader = new FileReader();
			reader.onload = (e) => {
				cleanupInput();
				const result = parseBackup(e.target?.result as string);
				if ('error' in result) {
					new Notice(t('settings.backup.restore.invalid', { error: t(`settings.backup.restore.errors.${result.error}` as TranslationKey) }));
					return;
				}
				// validated as a whole before anything is written
				const legacy = 'legacy' in result ? result.legacy : null;
				const prompt = legacy
					? t('settings.backup.restore.confirmLegacy')
					: t('settings.backup.restore.confirm');
				new ConfirmModal(this.app, prompt, () => {
					void (async () => {
						const managers = this.plugin.backupManagers();
						if (legacy) {
							const errors = await restoreLegacyBackup(managers, legacy);
							if (errors.length > 0) {
								new Notice(t('settings.backup.restore.failed', { errors: errors.join('; ') }));
								return;
							}
						} else if ('backup' in result) {
							await restoreBackup(managers, result.backup);
						}
						await this.plugin.loadSettings();
						activeDocument.dispatchEvent(new CustomEvent('watchlog-data-changed'));
						new Notice(t('settings.backup.restore.done'));
					})();
				}).open();
			};
			reader.readAsText(file);
		});
		input.click();
	}

	private async refetchAllPosters(): Promise<void> {
		const p = this.plugin;
		const res = await refreshAllCovers({
			api: p.apiService,
			gamesApiSource: p.settings.gamesApiSource ?? 'rawg',
			dataManager: p.dataManager,
			posterService: p.posterService,
			readingData: p.readingDataManager,
			gameData: p.gameDataManager,
			queue: p.dataManager.apiQueue,
			onStart: (n) => new Notice(t('settings.general.replaceImages.start', { count: n })),
		});
		new Notice(t('settings.general.replaceImages.done', { updated: res.updated, unchanged: res.unchanged }));
	}

	/**
	 * Starts a cancelable bulk run: registers it with the shared importProgress infra (the
	 * Watchlist header draws the cancel button) and shows a persistent in-place notice with
	 * its own cancel button, since the header bar isn't visible from Settings.
	 */
	private startProgress(total: number, text: string): {
		notice: Notice;
		label: HTMLElement;
		cancelFn: () => void;
		isCancelled: () => boolean;
	} {
		let cancelled = false;
		const cancelFn = (): void => { cancelled = true; };
		this.plugin.importProgress = { current: 0, total, cancel: cancelFn };
		this.plugin.dataManager.notifyChange();

		const notice = new Notice('', 0);
		const label = notice.messageEl.createSpan({ text });
		const cancelBtn = notice.messageEl.createEl('button', { cls: 'wl-btn wl-btn-sm wl-notice-cancel-btn', text: t('common.cancel') });
		cancelBtn.addEventListener('click', cancelFn);
		return { notice, label, cancelFn, isCancelled: () => cancelled };
	}

	/**
	 * Rewrites the frontmatter block on every existing note (Watchlist + Reading),
	 * preserving each body. Missing files are skipped, never created. Chunked, with a
	 * cancelable progress notice via the shared importProgress infrastructure.
	 */
	private async rewriteAllFrontmatter(): Promise<void> {
		const dm = this.plugin.dataManager;
		const reading = this.plugin.readingDataManager;
		const titles = dm.getTitles();
		const books = reading.getBooks();
		const manga = reading.getMangaList();
		const total = titles.length + books.length + manga.length;
		if (total === 0) {
			new Notice(t('settings.general.rewrite.none'));
			return;
		}

		// one flat list of work units; true = rewritten, false = skipped (no file on disk)
		const jobs: Array<() => Promise<boolean>> = [
			...titles.map((t) => () => dm.rewriteFrontmatterIfExists(t)),
			...books.map((b) => () => reading.rewriteFrontmatterIfExists('book', b)),
			...manga.map((m) => () => reading.rewriteFrontmatterIfExists('manga', m)),
		];

		const { notice, label, cancelFn, isCancelled } = this.startProgress(
			total,
			t('settings.general.rewrite.progress', { done: 0, total }),
		);

		const CHUNK_SIZE = 10;
		let rewritten = 0;
		let skipped = 0;
		let done = 0;
		try {
			for (let i = 0; i < jobs.length; i++) {
				if (isCancelled()) break;
				if (await jobs[i]!()) rewritten++; else skipped++;
				done++;
				// yield every chunk so the UI repaints and stays responsive across 700+ notes
				if (done % CHUNK_SIZE === 0 || done === total) {
					this.plugin.importProgress = { current: done, total, cancel: cancelFn };
					label.textContent = t('settings.general.rewrite.progress', { done, total });
					await new Promise((r) => window.setTimeout(r, 0));
				}
			}
		} finally {
			this.plugin.importProgress = null;
			dm.notifyChange();
			notice.hide();
		}

		const state = isCancelled() ? t('settings.progress.cancelled') : t('settings.progress.done');
		new Notice(skipped > 0
			? t('settings.general.rewrite.resultSkipped', { state, count: rewritten, skipped })
			: t('settings.general.rewrite.result', { state, count: rewritten }));
	}

	/** Bulk studio backfill; the rewriteAllFrontmatter progress/cancel pattern. */
	private async fetchAllStudios(): Promise<void> {
		const dm = this.plugin.dataManager;
		const pending = dm.getTitles().filter((title) => needsStudioFetch(title));
		const total = pending.length;
		if (total === 0) {
			new Notice(t('settings.general.studios.allHave'));
			return;
		}

		const { notice, label, cancelFn, isCancelled } = this.startProgress(
			total,
			t('settings.general.studios.progress', { done: 0, total }),
		);

		const animeSource = this.plugin.settings.animeApiSource ?? 'jikan';
		let filled = 0;
		let missed = 0;
		try {
			for (let i = 0; i < pending.length; i++) {
				if (isCancelled()) break;
				const title = pending[i]!;
				try {
					const group = getApiGroupForType(title.type, this.plugin.settings.typeApiMapping);
					const found = await this.plugin.apiService.fetchStudio(title, animeSource, group);
					// a miss stores 'none' so the next run skips it instead of retrying forever
					await dm.updateStudio(title.id, found?.studio ?? [CREDITS_NONE], found?.tmdbId, found?.tmdbMediaType);
					if (found?.studio && !isCreditsNone(found.studio)) filled++; else missed++;
				} catch {
					missed++;
				}
				this.plugin.importProgress = { current: i + 1, total, cancel: cancelFn };
				label.textContent = t('settings.general.studios.progress', { done: i + 1, total });
				await new Promise((r) => window.setTimeout(r, 0));
			}
		} finally {
			this.plugin.importProgress = null;
			dm.notifyChange();
			notice.hide();
		}

		const state = isCancelled() ? t('settings.progress.cancelled') : t('settings.progress.done');
		new Notice(missed > 0
			? t('settings.general.studios.resultMissed', { state, count: filled, missed })
			: t('settings.general.studios.result', { state, count: filled }));
	}

	private async runRegenerate(
		progressWrap: HTMLElement,
		progressBarFill: HTMLElement,
		progressText: HTMLElement,
	): Promise<void> {
		const titles = this.plugin.dataManager.getTitles();
		const reading = this.plugin.readingDataManager;
		const books = reading.getBooks();
		const manga = reading.getMangaList();
		const total = titles.length + books.length + manga.length;
		progressWrap.show();
		if (total === 0) {
			progressText.textContent = t('settings.backup.regenerate.none');
			return;
		}
		progressBarFill.style.width = `0%`;
		progressText.textContent = `0 / ${total}`;
		let created = 0;
		let skipped = 0;
		let done = 0;
		const tick = (wasCreated: boolean): void => {
			if (wasCreated) created++; else skipped++;
			done++;
			const pct = Math.round((done / total) * 100);
			progressBarFill.style.width = `${pct}%`;
			progressText.textContent = `${done} / ${total}`;
		};
		for (const title of titles) {
			tick(await this.plugin.dataManager.createMarkdownFileIfMissing(title));
		}
		for (const book of books) {
			tick(await reading.createReadingNoteIfMissing('book', book));
		}
		for (const m of manga) {
			tick(await reading.createReadingNoteIfMissing('manga', m));
		}
		if (created === 0) {
			progressText.textContent = t('settings.backup.regenerate.none');
		} else {
			progressText.textContent = t('settings.backup.regenerate.result', { count: created, skipped });
		}
	}

	// Settings groups (shared by API + Customize)

	/** Repaints a chip element's tone class. */
	/** Failed Test → short chip label + the full cause underneath. */
	private testFailure(err: unknown): ChipStatus {
		return { text: apiErrorShort(err), tone: 'error', detail: apiErrorMessage(err) };
	}

	private setChipTone(chip: HTMLElement, tone: ChipTone): void {
		chip.removeClasses(['is-ok', 'is-warn', 'is-error', 'is-idle', 'is-pending', 'is-count']);
		chip.addClass(`is-${tone}`);
	}

	/**
	 * One coloured settings group: accent header (icon disc, title, sub-line, live chip)
	 * over a plain body. The accent lives in the header only, so nothing fights a tint.
	 */
	private settingsGroup(
		parent: HTMLElement,
		opts: {
			title: string;
			sub: string;
			icon: string;
			variant: SettingsGroupVariant;
			/**
			 * body holds bare Obsidian `Setting` rows, which carry their own separators — so the
			 * body drops its gap
			 */
			rows?: boolean;
		},
	): { head: HTMLElement; body: HTMLElement; setChip: (status: ChipStatus) => void } {
		const box = parent.createDiv({ cls: `wl-sg wl-sg--${opts.variant}` });

		const head = box.createDiv({ cls: 'wl-sg-head' });
		const icon = head.createDiv({ cls: 'wl-sg-icon' });
		setIcon(icon, opts.icon);
		const titles = head.createDiv({ cls: 'wl-sg-titles' });
		titles.createDiv({ cls: 'wl-sg-title', text: opts.title });
		titles.createDiv({ cls: 'wl-sg-sub', text: opts.sub });

		const chip = head.createDiv({ cls: 'wl-sg-chip' });
		chip.createSpan({ cls: 'wl-sg-chip-dot' });
		const chipText = chip.createSpan({ cls: 'wl-sg-chip-text' });
		// groups with nothing to report never call setChip — an empty pill reads as broken
		chip.hide();

		return {
			head,
			body: box.createDiv({ cls: `wl-sg-body${opts.rows ? ' wl-sg-body--rows' : ''}` }),
			setChip: (status) => {
				chipText.textContent = status.text;
				this.setChipTone(chip, status.tone);
				chip.toggle(status.text.length > 0);
			},
		};
	}

	/**
	 * A sub-card inside a settings group — the Customize counterpart of the API page's
	 * provider card: label, optional (?) explanation, caller-filled body.
	 */
	private sgCard(
		parent: HTMLElement,
		opts: { label: string; help?: string },
	): HTMLElement {
		const card = parent.createDiv({ cls: 'wl-sg-card' });

		const head = card.createDiv({ cls: 'wl-sg-card-head' });
		head.createDiv({ cls: 'wl-sg-card-label', text: opts.label });

		if (opts.help) {
			const tools = head.createDiv({ cls: 'wl-sg-card-tools' });
			const toggle = tools.createEl('button', {
				cls: 'wl-sg-icon-btn wl-sg-help-btn',
				text: '?',
				attr: { 'aria-label': t('settings.about', { label: opts.label }) },
			});
			const help = card.createDiv({ cls: 'wl-sg-help wl-sg-help--card', text: opts.help });
			toggle.addEventListener('click', () => {
				const open = !help.hasClass('is-open');
				help.toggleClass('is-open', open);
				toggle.toggleClass('is-active', open);
			});
		}

		return card.createDiv({ cls: 'wl-sg-card-body' });
	}

	/** Segmented picker replacing the old "which API" dropdown. */
	private apiSegmented(
		parent: HTMLElement,
		opts: {
			label: string;
			options: { value: string; label: string }[];
			value: string;
			onChange: (v: string) => void;
		},
	): void {
		const row = parent.createDiv({ cls: 'wl-sg-seg-row' });
		row.createDiv({ cls: 'wl-sg-seg-label', text: opts.label });

		const wrap = row.createDiv({ cls: 'wl-sg-seg' });
		const btns = new Map<string, HTMLElement>();
		for (const o of opts.options) {
			const btn = wrap.createEl('button', { cls: 'wl-sg-seg-btn', text: o.label });
			btns.set(o.value, btn);
			btn.addEventListener('click', () => {
				btns.forEach((el, v) => {
					if (v === o.value) { el.addClass('is-active'); } else { el.removeClass('is-active'); }
				});
				opts.onChange(o.value);
			});
		}
		btns.get(opts.value)?.addClass('is-active');
	}

	/**
	 * A provider card: avatar + name + state on top, credential fields, then a footer with
	 * the status chip and the link / help / Test actions. Every keystroke recomputes the
	 * status, so an old "Connected" never outlives the key it was tested with.
	 */
	private apiProvider(parent: HTMLElement, spec: ApiProviderSpec): ApiProviderHandle {
		const card = parent.createDiv({ cls: 'wl-api-provider' });

		const head = card.createDiv({ cls: 'wl-api-provider-head' });
		head.createDiv({ cls: 'wl-api-provider-avatar', text: spec.initials });
		const names = head.createDiv({ cls: 'wl-api-provider-names' });
		names.createDiv({ cls: 'wl-api-provider-name', text: spec.name });
		if (spec.note) names.createDiv({ cls: 'wl-api-provider-note', text: spec.note });
		const state = head.createDiv({ cls: 'wl-api-provider-state' });
		if (spec.badge) state.textContent = spec.badge;

		// credential fields
		for (const f of spec.fields ?? []) {
			const field = card.createDiv({ cls: 'wl-api-field' });
			field.createDiv({ cls: 'wl-api-field-label', text: f.label });
			// plain fields keep the reveal button's gutter so every input ends on the same edge
			const row = field.createDiv({
				cls: `wl-api-field-row${f.secret ? '' : ' wl-api-field-row--plain'}`,
			});

			const input = row.createEl('input', { cls: 'wl-api-input' });
			input.type = f.secret ? 'password' : 'text';
			input.placeholder = f.placeholder;
			input.value = f.get();
			input.addEventListener('input', () => {
				f.set(input.value);
				refreshStatus();
			});
			f.onInput?.(input);

			if (f.secret) {
				const eye = row.createEl('button', { cls: 'wl-sg-icon-btn', attr: { 'aria-label': t('settings.api.showKey') } });
				setIcon(eye, 'eye');
				eye.addEventListener('click', () => {
					const hidden = input.type === 'password';
					input.type = hidden ? 'text' : 'password';
					setIcon(eye, hidden ? 'eye-off' : 'eye');
					eye.setAttribute('aria-label', hidden ? t('settings.api.hideKey') : t('settings.api.showKey'));
				});
			}
		}

		// footer: status + actions
		const foot = card.createDiv({ cls: 'wl-api-provider-foot' });
		const chip = foot.createDiv({ cls: 'wl-sg-chip' });
		chip.createSpan({ cls: 'wl-sg-chip-dot' });
		const chipText = chip.createSpan({ cls: 'wl-sg-chip-text' });

		const actions = foot.createDiv({ cls: 'wl-api-actions' });
		if (spec.link) {
			const a = actions.createEl('a', {
				cls: 'wl-api-link',
				href: spec.link.href,
				attr: { target: '_blank', rel: 'noopener noreferrer' },
			});
			a.createSpan({ text: spec.link.text });
			setIcon(a.createSpan({ cls: 'wl-api-link-icon' }), 'external-link');
		}

		let help: HTMLElement | null = null;
		if (spec.help) {
			const toggle = actions.createEl('button', {
				cls: 'wl-sg-icon-btn wl-sg-help-btn',
				text: '?',
				attr: { 'aria-label': t('settings.about', { label: spec.name }) },
			});
			toggle.addEventListener('click', () => {
				if (!help) return;
				const open = !help.hasClass('is-open');
				help.toggleClass('is-open', open);
				toggle.toggleClass('is-active', open);
			});
		}

		const diagnosis = card.createDiv({ cls: 'wl-api-diagnosis' });
		diagnosis.hide();

		const setStatus = (status: ChipStatus): void => {
			chipText.textContent = status.text;
			this.setChipTone(chip, status.tone);
			diagnosis.textContent = status.detail ?? '';
			diagnosis.toggle(!!status.detail);
		};
		const refreshStatus = (): void => setStatus(spec.status());

		const runTest = spec.test;
		if (runTest) {
			const test = actions.createEl('button', { cls: 'wl-api-test', text: t('settings.api.test') });
			test.addEventListener('click', () => {
				test.disabled = true;
				setStatus({ text: t('settings.api.testing'), tone: 'pending' });
				void (async () => {
					try {
						setStatus(await runTest());
					} finally {
						test.disabled = false;
					}
				})();
			});
		}

		if (spec.help) {
			help = card.createDiv({ cls: 'wl-sg-help', text: spec.help });
		}
		spec.extra?.(card);

		refreshStatus();

		return {
			setActive: (active) => {
				if (active === null) return;
				card.toggleClass('is-inactive', !active);
				state.textContent = active ? t('settings.api.active') : t('settings.api.inactive');
				state.toggleClass('is-active', active);
			},
			refreshStatus,
		};
	}

	private renderApi(el: HTMLElement): void {
		const page = el.createDiv({ cls: 'wl-sg-page' });
		const s = this.plugin.settings;

		// 1. Movies & TV shows
		const movies = this.settingsGroup(page, {
			title: t('settings.api.movies.title'),
			sub: t('settings.api.movies.sub'),
			icon: 'clapperboard',
			variant: 'movies',
		});

		let omdb: ApiProviderHandle;
		let tmdb: ApiProviderHandle;
		const syncMovies = (): void => {
			const active = s.activeApi ?? 'OMDb';
			omdb.setActive(active === 'OMDb');
			tmdb.setActive(active === 'TMDB');
			const keyed = active === 'OMDb' ? !!s.omdbApiKey : !!s.tmdbApiKey;
			movies.setChip(
				keyed
					? { text: t('settings.api.chipKeySet', { name: active }), tone: 'ok' }
					: { text: t('settings.api.chipKeyNeeded', { name: active }), tone: 'warn' },
			);
		};

		this.apiSegmented(movies.body, {
			label: t('settings.api.activeApi'),
			options: [{ value: 'OMDb', label: 'OMDb' }, { value: 'TMDB', label: 'TMDB' }],
			value: s.activeApi ?? 'OMDb',
			onChange: (v) => {
				s.activeApi = v as 'OMDb' | 'TMDB';
				void this.plugin.saveSettings();
				syncMovies();
			},
		});

		omdb = this.apiProvider(movies.body, {
			name: 'OMDb',
			initials: 'O',
			note: t('settings.api.omdb.note'),
			link: { text: t('settings.api.getFreeKey'), href: 'https://www.omdbapi.com/apikey.aspx' },
			help: t('settings.api.omdb.help'),
			fields: [{
				label: t('settings.api.apiKey'),
				placeholder: t('settings.api.omdb.placeholder'),
				secret: true,
				get: () => s.omdbApiKey,
				set: (v) => {
					s.omdbApiKey = v;
					this.plugin.apiService.setOmdbKey(v);
					this.debouncedSaveSettings();
					syncMovies();
				},
			}],
			status: () => (s.omdbApiKey
				? { text: t('settings.api.keySetNotTested'), tone: 'idle' }
				: { text: t('settings.api.noKey'), tone: 'idle' }),
			test: async () => {
				try {
					const ok = await this.plugin.apiService.checkOmdbConnection();
					return ok
						? { text: t('settings.api.connected'), tone: 'ok' as const }
						: { text: t('settings.api.failedCheckKey'), tone: 'error' as const };
				} catch (err) {
					return this.testFailure(err);
				}
			},
		});

		tmdb = this.apiProvider(movies.body, {
			name: 'TMDB',
			initials: 'T',
			note: t('settings.api.tmdb.note'),
			link: { text: t('settings.api.getFreeToken'), href: 'https://www.themoviedb.org/settings/api' },
			help: t('settings.api.tmdb.help'),
			fields: [{
				label: t('settings.api.tmdb.field'),
				placeholder: t('settings.api.tmdb.placeholder'),
				secret: true,
				get: () => s.tmdbApiKey ?? '',
				set: (v) => {
					s.tmdbApiKey = v;
					this.plugin.apiService.setTmdbKey(v);
					this.debouncedSaveSettings();
					syncMovies();
				},
			}],
			status: () => (s.tmdbApiKey
				? { text: t('settings.api.tokenSetNotTested'), tone: 'idle' }
				: { text: t('settings.api.noToken'), tone: 'idle' }),
			test: async () => {
				try {
					const ok = await this.plugin.apiService.checkTmdbConnection();
					return ok
						? { text: t('settings.api.connected'), tone: 'ok' as const }
						: { text: t('settings.api.failedCheckToken'), tone: 'error' as const };
				} catch (err) {
					return this.testFailure(err);
				}
			},
		});
		syncMovies();

		movies.body.createDiv({
			cls: 'wl-sg-note',
			text: t('settings.api.movies.note'),
		});

		// 2. Anime
		const anime = this.settingsGroup(page, {
			title: t('settings.api.anime.title'),
			sub: t('settings.api.anime.sub'),
			icon: 'sparkles',
			variant: 'anime',
		});
		anime.setChip({ text: t('settings.api.anime.chip'), tone: 'ok' });

		let jikan: ApiProviderHandle;
		let anilist: ApiProviderHandle;
		const syncAnime = (): void => {
			const active = s.animeApiSource ?? 'jikan';
			jikan.setActive(active === 'jikan');
			anilist.setActive(active === 'anilist');
		};

		this.apiSegmented(anime.body, {
			label: t('settings.api.activeApi'),
			options: [{ value: 'jikan', label: 'MyAnimeList' }, { value: 'anilist', label: 'AniList' }],
			value: s.animeApiSource ?? 'jikan',
			onChange: (v) => {
				s.animeApiSource = v as 'jikan' | 'anilist';
				void this.plugin.saveSettings();
				syncAnime();
			},
		});

		let endpointInput: HTMLInputElement | null = null;
		const setEndpoint = (v: string): void => {
			s.jikanBaseUrl = v;
			void this.plugin.saveSettings();
			this.plugin.apiService.setJikanEndpoint(resolveJikanEndpoint(v));
		};
		jikan = this.apiProvider(anime.body, {
			name: 'MyAnimeList',
			initials: 'M',
			note: t('settings.api.jikan.note'),
			fields: [{
				label: t('settings.api.jikan.endpoint'),
				placeholder: TENRAI_BASE,
				get: () => s.jikanBaseUrl ?? '',
				set: setEndpoint,
				onInput: (el) => { endpointInput = el; },
			}],
			status: () => jikanEndpointStatus(s.jikanBaseUrl ?? ''),
			test: async () => {
				try {
					return (await this.plugin.apiService.pingJikan())
						? { text: t('settings.api.connected'), tone: 'ok' as const }
						: { text: t('settings.api.jikan.notCompatible'), tone: 'error' as const };
				} catch (err) {
					return this.testFailure(err);
				}
			},
			help: t('settings.api.jikan.help'),
			extra: (card) => {
				const row = card.createDiv({ cls: 'wl-api-presets' });
				const btn = row.createEl('button', { cls: 'wl-btn wl-btn-sm', text: t('settings.api.jikan.useTenrai') });
				btn.addEventListener('click', () => {
					if (!endpointInput) return;
					endpointInput.value = '';
					// the field's own listener saves, updates the service and the chip
					endpointInput.dispatchEvent(new Event('input'));
				});
			},
		});

		anilist = this.apiProvider(anime.body, {
			name: 'AniList',
			initials: 'A',
			note: t('settings.api.anilist.note'),
			status: () => ({ text: t('settings.api.noKeyNeeded'), tone: 'ok' }),
			help: t('settings.api.anilist.help'),
		});
		syncAnime();

		anime.body.createDiv({
			cls: 'wl-sg-note',
			text: t('settings.api.anime.note'),
		});

		// 3. Books & manga
		const books = this.settingsGroup(page, {
			title: t('settings.api.books.title'),
			sub: t('settings.api.books.sub'),
			icon: 'book-open',
			variant: 'books',
		});
		const syncBooks = (): void => {
			books.setChip(
				s.googleBooksApiKey
					? { text: t('settings.api.chipKeySet', { name: t('settings.reading.subTab.books') }), tone: 'ok' }
					: { text: t('settings.api.chipKeyNeeded', { name: t('settings.reading.subTab.books') }), tone: 'warn' },
			);
		};

		this.apiProvider(books.body, {
			name: 'Google Books',
			initials: 'G',
			note: t('settings.api.books.google.note'),
			badge: t('settings.reading.subTab.books'),
			link: { text: 'Google Cloud Console', href: 'https://console.cloud.google.com/apis/credentials' },
			help: t('settings.api.books.google.help'),
			fields: [{
				label: t('settings.api.apiKey'),
				placeholder: t('settings.api.books.google.placeholder'),
				secret: true,
				get: () => s.googleBooksApiKey ?? '',
				set: (v) => {
					s.googleBooksApiKey = v;
					this.plugin.apiService.setGoogleBooksKey(v);
					this.debouncedSaveSettings();
					syncBooks();
				},
			}],
			status: () => (s.googleBooksApiKey
				? { text: t('settings.api.keySetNotTested'), tone: 'idle' }
				: { text: t('settings.api.books.google.noKey'), tone: 'warn' }),
			test: async () => {
				try {
					const ok = await this.plugin.apiService.checkGoogleBooksConnection();
					return ok
						? { text: t('settings.api.connected'), tone: 'ok' as const }
						: { text: t('settings.api.failed'), tone: 'error' as const };
				} catch (err) {
					return this.testFailure(err);
				}
			},
		});
		syncBooks();

		this.apiProvider(books.body, {
			name: 'MyAnimeList',
			initials: 'M',
			note: t('settings.api.books.manga.note'),
			badge: t('settings.reading.subTab.manga'),
			status: () => ({ text: t('settings.api.noKeyNeeded'), tone: 'ok' }),
			help: t('settings.api.books.manga.help'),
		});

		// 4. Games
		const games = this.settingsGroup(page, {
			title: t('app.tabs.games'),
			sub: t('settings.api.games.sub'),
			icon: 'gamepad-2',
			variant: 'games',
		});

		let rawg: ApiProviderHandle;
		let igdb: ApiProviderHandle;
		const syncGames = (): void => {
			const active = s.gamesApiSource ?? 'rawg';
			rawg.setActive(active === 'rawg');
			igdb.setActive(active === 'igdb');
			const keyed = active === 'rawg'
				? !!s.rawgApiKey
				: !!(s.igdbClientId && s.igdbClientSecret);
			games.setChip(
				keyed
					? { text: t('settings.api.chipKeySet', { name: active === 'rawg' ? 'RAWG' : 'IGDB' }), tone: 'ok' }
					: { text: t('settings.api.chipKeyNeeded', { name: active === 'rawg' ? 'RAWG' : 'IGDB' }), tone: 'warn' },
			);
		};

		this.apiSegmented(games.body, {
			label: t('settings.api.activeApi'),
			options: [{ value: 'rawg', label: 'RAWG' }, { value: 'igdb', label: 'IGDB' }],
			value: s.gamesApiSource ?? 'rawg',
			onChange: (v) => {
				s.gamesApiSource = v as 'rawg' | 'igdb';
				void this.plugin.saveSettings();
				syncGames();
			},
		});

		rawg = this.apiProvider(games.body, {
			name: 'RAWG',
			initials: 'R',
			note: t('settings.api.rawg.note'),
			link: { text: t('settings.api.getFreeKey'), href: 'https://rawg.io/apidocs' },
			help: t('settings.api.rawg.help'),
			fields: [{
				label: t('settings.api.apiKey'),
				placeholder: t('settings.api.rawg.placeholder'),
				secret: true,
				get: () => s.rawgApiKey ?? '',
				set: (v) => {
					s.rawgApiKey = v;
					this.plugin.apiService.setRawgKey(v);
					this.debouncedSaveSettings();
					syncGames();
				},
			}],
			status: () => (s.rawgApiKey
				? { text: t('settings.api.keySetNotTested'), tone: 'idle' }
				: { text: t('settings.api.noKey'), tone: 'idle' }),
			test: async () => {
				try {
					const ok = await this.plugin.apiService.checkRawgConnection();
					return ok
						? { text: t('settings.api.connected'), tone: 'ok' as const }
						: { text: t('settings.api.failedCheckKey'), tone: 'error' as const };
				} catch (err) {
					return this.testFailure(err);
				}
			},
		});

		igdb = this.apiProvider(games.body, {
			name: 'IGDB',
			initials: 'I',
			note: t('settings.api.igdb.note'),
			link: { text: t('settings.api.igdb.link'), href: 'https://dev.twitch.tv/console/apps' },
			help: t('settings.api.igdb.help'),
			fields: [
				{
					label: t('settings.api.igdb.clientId'),
					placeholder: t('settings.api.igdb.clientIdPlaceholder'),
					secret: true,
					get: () => s.igdbClientId ?? '',
					set: (v) => {
						s.igdbClientId = v;
						this.plugin.apiService.setIgdbCredentials(v, s.igdbClientSecret ?? '');
						this.debouncedSaveSettings();
						syncGames();
					},
				},
				{
					label: t('settings.api.igdb.clientSecret'),
					placeholder: t('settings.api.igdb.clientSecretPlaceholder'),
					secret: true,
					get: () => s.igdbClientSecret ?? '',
					set: (v) => {
						s.igdbClientSecret = v;
						this.plugin.apiService.setIgdbCredentials(s.igdbClientId ?? '', v);
						this.debouncedSaveSettings();
						syncGames();
					},
				},
			],
			status: () => (s.igdbClientId && s.igdbClientSecret
				? { text: t('settings.api.credsSetNotTested'), tone: 'idle' }
				: { text: t('settings.api.credsIncomplete'), tone: 'idle' }),
			test: async () => {
				try {
					const ok = await this.plugin.apiService.checkIgdbConnection();
					return ok
						? { text: t('settings.api.connected'), tone: 'ok' as const }
						: { text: t('settings.api.failedCheckIdSecret'), tone: 'error' as const };
				} catch (err) {
					return this.testFailure(err);
				}
			},
		});
		syncGames();

		// Steam sits outside the segmented pair on purpose: no search endpoint, so it can't back
		// the add flow — it only syncs playtime and achievements from your own account
		let steamIdInput: HTMLInputElement | null = null;
		const steam = this.apiProvider(games.body, {
			name: 'Steam',
			initials: 'S',
			note: t('settings.steam.note'),
			badge: t('settings.steam.badge'),
			link: { text: t('settings.steam.link'), href: 'https://steamcommunity.com/dev/apikey' },
			help: t('settings.steam.help'),
			fields: [
				{
					label: t('settings.steam.apiKey'),
					placeholder: t('settings.steam.apiKeyPlaceholder'),
					secret: true,
					get: () => s.steamApiKey ?? '',
					set: (v) => {
						s.steamApiKey = v;
						this.plugin.apiService.setSteamCredentials(v, s.steamId ?? '');
						this.debouncedSaveSettings();
					},
				},
				{
					label: t('settings.steam.idField'),
					placeholder: '76561198… or steamcommunity.com/id/yourname',
					get: () => s.steamId ?? '',
					set: (v) => {
						s.steamId = v;
						this.plugin.apiService.setSteamCredentials(s.steamApiKey ?? '', v);
						this.debouncedSaveSettings();
					},
					onInput: (input) => { steamIdInput = input; },
				},
			],
			status: () => (s.steamApiKey && s.steamId
				? { text: t('settings.api.credsSetNotTested'), tone: 'idle' }
				: { text: t('settings.api.credsIncomplete'), tone: 'idle' }),
			test: async () => {
				// resolve a vanity name / URL to a SteamID64 once and store it. The field is written in
				// place rather than via this.display(), which would detach the elements this handler holds.
				const resolved = await this.plugin.apiService.resolveSteamId(s.steamId ?? '');
				if (resolved && resolved !== s.steamId) {
					s.steamId = resolved;
					if (steamIdInput) steamIdInput.value = resolved;
					await this.plugin.saveSettings();
				}
				this.plugin.apiService.setSteamCredentials(s.steamApiKey ?? '', resolved || (s.steamId ?? ''));

				const result = await this.plugin.apiService.checkSteamConnection();
				return result.ok
					? { text: t('settings.steam.connected', { count: result.games.length }), tone: 'ok' as const }
					: { text: steamFailureLabel(result.reason), tone: 'error' as const };
			},
			extra: (card) => {
				const row = card.createDiv({ cls: 'wl-api-action' });
				const texts = row.createDiv({ cls: 'wl-api-action-texts' });
				texts.createDiv({ cls: 'wl-api-action-title', text: t('settings.steam.sync.title') });
				texts.createDiv({
					cls: 'wl-api-action-desc',
					text: t('settings.steam.sync.desc'),
				});
				const btn = row.createEl('button', { cls: 'wl-api-action-btn mod-cta', text: t('settings.steam.sync.button') });
				btn.addEventListener('click', () => {
					if (!this.plugin.apiService.hasSteamCredentials()) {
						new Notice(t('settings.steam.sync.needCreds'));
						return;
					}
					new SteamSyncModal(this.app, this.plugin, this.plugin.gameDataManager).open();
				});
			},
		});
		steam.setActive(null);

		// API routing (always last)
		this.renderTypeApiMapping(page);
	}

	private renderTypeApiMapping(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: 'wl-settings-card' });
		card.createDiv({ cls: 'wl-settings-card-title', text: t('settings.api.routing.title') });
		card.createDiv({
			cls: 'wl-settings-card-desc',
			text: t('settings.api.routing.desc'),
		});

		const list = card.createDiv({ cls: 'wl-type-api-list' });
		const allTypes = this.plugin.settings.types ?? [];
		const mapping = this.plugin.settings.typeApiMapping ?? {};

		// prune stale entries (types that no longer exist)
		const validNames = new Set(allTypes.map((type) => type.name));
		let pruned = false;
		for (const key of Object.keys(mapping)) {
			if (!validNames.has(key) || key === 'Anime' || key === 'Movie' || key === 'TV Show' || key === 'TvShow') {
				delete mapping[key];
				pruned = true;
			}
		}
		if (pruned) void this.plugin.saveSettings();

		for (const type of allTypes) {
			const row = list.createDiv({ cls: 'wl-type-api-row' });
			row.createSpan({ cls: 'wl-type-api-name', text: typeLabel(type.name) });

			if (type.name === 'Anime') {
				row.createSpan({ cls: 'wl-type-api-locked', text: t('settings.api.routing.locked', { apis: 'Jikan / AniList' }) });
			} else if (type.name === 'Movie' || type.name === 'TV Show' || type.name === 'TvShow') {
				row.createSpan({ cls: 'wl-type-api-locked', text: t('settings.api.routing.locked', { apis: 'OMDb / TMDB' }) });
			} else {
				const select = row.createEl('select', { cls: 'wl-select wl-type-api-select' });
				const current = mapping[type.name] ?? '';
				const opts: Array<{ value: '' | 'anime' | 'movie'; label: string }> = [
					{ value: '', label: t('settings.api.routing.notSet') },
					{ value: 'anime', label: t('settings.api.routing.anime') },
					{ value: 'movie', label: t('settings.api.routing.movie') },
				];
				for (const o of opts) {
					const optEl = select.createEl('option', { text: o.label, value: o.value });
					if (current === o.value) optEl.selected = true;
				}
				select.addEventListener('change', () => {
					const v = select.value as '' | 'anime' | 'movie';
					if (!this.plugin.settings.typeApiMapping) this.plugin.settings.typeApiMapping = {};
					if (v === '') {
						delete this.plugin.settings.typeApiMapping[type.name];
					} else {
						this.plugin.settings.typeApiMapping[type.name] = v;
					}
					void this.plugin.saveSettings();
				});
			}
		}
	}

	// Customize

	/**
	 * Customize is grouped per library, reusing the API callouts (blue Watchlist / yellow
	 * Reading / red Games). Priority and the Rating system stay ungrouped below — they are
	 * shared by all three.
	 */
	private renderCustomize(el: HTMLElement): void {
		const page = el.createDiv({ cls: 'wl-sg-page' });
		const s = this.plugin.settings;

		// theme
		const theme = this.settingsGroup(page, {
			title: t('settings.customize.theme.title'),
			sub: t('settings.customize.theme.sub'),
			icon: 'palette',
			variant: 'theme',
		});
		this.renderThemePicker(theme.body, (label) => theme.setChip({ text: label, tone: 'count' }));

		// cards
		const cards = this.settingsGroup(page, {
			title: t('settings.customize.cards.title'),
			sub: t('settings.customize.cards.sub'),
			icon: 'layout-grid',
			variant: 'cards',
		});
		this.renderCardSettings(cards.body, (label) => cards.setChip({ text: label, tone: 'count' }));

		// watchlist
		const watchlist = this.settingsGroup(page, {
			title: t('app.tabs.watchlist'),
			sub: t('settings.customize.watchlist.sub'),
			icon: 'clapperboard',
			variant: 'watchlist',
		});
		const syncWatchlist = (): void => watchlist.setChip({
			text: this.chipJoin(
				t('settings.chip.types', { count: s.types.length }),
				t('settings.chip.statuses', { count: s.statuses.length }),
			),
			tone: 'count',
		});
		this.renderTagSection(watchlist.body, t('settings.tags.type'), 'types', syncWatchlist);
		this.renderTagSection(watchlist.body, t('settings.tags.status'), 'statuses', syncWatchlist);
		this.renderSeasonColors(watchlist.body);
		syncWatchlist();

		// reading
		const reading = this.settingsGroup(page, {
			title: t('app.tabs.reading'),
			sub: t('settings.customize.reading.sub'),
			icon: 'book-open',
			variant: 'reading',
		});
		this.renderReadingColors(reading.body);
		this.renderReadingStatusColors(reading.body);
		reading.setChip({
			text: this.chipJoin(
				t('settings.chip.types', { count: 2 }),
				t('settings.chip.statuses', { count: READING_STATUSES.length }),
			),
			tone: 'count',
		});

		// games
		const games = this.settingsGroup(page, {
			title: t('app.tabs.games'),
			sub: t('settings.customize.games.sub'),
			icon: 'gamepad-2',
			variant: 'games',
		});
		const gamesSettings = (): GamesSettings => this.plugin.gameDataManager.getSettings();
		const syncGames = (): void => games.setChip({
			text: this.chipJoin(
				t('settings.chip.genres', { count: gamesSettings().types.length }),
				t('settings.chip.platforms', { count: gamesSettings().platforms.length }),
			),
			tone: 'count',
		});
		this.renderGamesTags(games.body, syncGames);
		syncGames();

		// shared across libraries
		const shared = this.settingsGroup(page, {
			title: t('settings.customize.shared.title'),
			sub: t('settings.customize.shared.sub'),
			icon: 'star',
			variant: 'shared',
		});
		const syncShared = (): void => shared.setChip({
			text: this.chipJoin(
				t('settings.chip.priorities', { count: s.priorities.length }),
				t('settings.chip.tiers', { count: s.ratingSystem.length }),
			),
			tone: 'count',
		});
		this.renderTagSection(shared.body, t('settings.tags.priority'), 'priorities', syncShared);
		this.renderRatingSystem(shared.body);
		syncShared();
	}

	/** Header-chip read-out of two counts, e.g. "6 types · 5 statuses". */
	private chipJoin(a: string, b: string): string {
		return `${a} · ${b}`;
	}

	/**
	 * Rating system — the five star tiers (1★…5★), each an editable colour + label. Drives
	 * every star control across Watchlist, Reading and Games. A whole star shares a tier
	 * with the half-step below (2.5★ and 3★ are both tier 3).
	 */
	private renderRatingSystem(el: HTMLElement): void {
		const wrap = this.sgCard(el, {
			label: t('settings.customize.rating.label'),
			help: t('settings.customize.rating.help'),
		});

		const list = wrap.createDiv({ cls: 'wl-rating-tier-list' });
		this.plugin.settings.ratingSystem.forEach((tier, idx) => {
			const tierNumber = idx + 1;
			const rowEl = list.createDiv({ cls: 'wl-rating-tier-row' });

			// clickable colour dot + hidden native picker
			const dotWrap = rowEl.createDiv({ cls: 'wl-tag-dot-wrap' });
			const dot = dotWrap.createSpan({ cls: 'wl-tag-dot' });
			dot.style.backgroundColor = tier.color;
			const colorPicker = dotWrap.createEl('input', {
				cls: 'wl-tag-color-picker',
				attr: { type: 'color', value: tier.color },
			});

			// static preview: `tierNumber` filled stars in the tier colour
			const preview = rowEl.createDiv({ cls: 'wl-star-rating wl-rating-tier-preview' });
			preview.style.setProperty('--wl-rating-color', tier.color);
			for (let i = 1; i <= 5; i++) {
				const star = preview.createSpan({ cls: 'wl-star', text: '★' });
				if (i <= tierNumber) star.addClass('is-active');
			}

			const labelInput = rowEl.createEl('input', {
				cls: 'wl-modal-input wl-rating-tier-label',
				attr: {
					type: 'text',
					value: tier.label,
					'aria-label': t('settings.customize.rating.labelAria', { tier: tierNumber }),
				},
			});

			dot.addEventListener('click', () => colorPicker.click());
			colorPicker.addEventListener('change', () => {
				void (async () => {
					tier.color = colorPicker.value;
					dot.style.backgroundColor = colorPicker.value;
					preview.style.setProperty('--wl-rating-color', colorPicker.value);
					await this.plugin.saveSettings();
					this.refreshOpenViews();
				})();
			});

			// commit on change/blur; an empty label reverts to the stored value
			const commitLabel = (): void => {
				const val = labelInput.value.trim();
				if (!val) { labelInput.value = tier.label; return; }
				if (val === tier.label) return;
				tier.label = val;
				void (async () => {
					await this.plugin.saveSettings();
					this.refreshOpenViews();
				})();
			};
			labelInput.addEventListener('change', commitLabel);
			labelInput.addEventListener('blur', commitLabel);
		});
	}

	/** Re-render open WatchLog views + widgets so a display-setting edit shows immediately. */
	private refreshOpenViews(): void {
		activeDocument.dispatchEvent(new CustomEvent('watchlog-data-changed'));
		const leaves = this.plugin.app.workspace.getLeavesOfType('watchlog-view');
		for (const leaf of leaves) {
			if (leaf.view instanceof WatchLogView) leaf.view.refreshUI();
		}
	}

	/** Reading type badge colours — two fixed entries (Manga, Book), colour picker only. */
	private renderReadingColors(el: HTMLElement): void {
		const wrap = this.sgCard(el, {
			label: t('settings.tags.type'),
			help: t('settings.customize.readingType.help'),
		});

		const entries: Array<{ label: string; kind: 'manga' | 'book' }> = [
			{ label: t('settings.customize.readingType.manga'), kind: 'manga' },
			{ label: t('settings.customize.readingType.book'), kind: 'book' },
		];

		const tagsEl = wrap.createDiv({ cls: 'wl-tags-list' });
		for (const { label, kind } of entries) {
			const pill = tagsEl.createDiv({ cls: 'wl-tag-pill' });

			const dotWrap = pill.createDiv({ cls: 'wl-tag-dot-wrap' });
			const dot = dotWrap.createSpan({ cls: 'wl-tag-dot' });
			dot.style.backgroundColor = this.plugin.settings.readingTypeColors[kind];
			const colorPicker = dotWrap.createEl('input', {
				cls: 'wl-tag-color-picker',
				attr: { type: 'color', value: this.plugin.settings.readingTypeColors[kind] },
			});
			dot.addEventListener('click', () => colorPicker.click());
			colorPicker.addEventListener('change', () => {
				void (async () => {
					this.plugin.settings.readingTypeColors[kind] = colorPicker.value;
					dot.style.backgroundColor = colorPicker.value;
					await this.plugin.saveSettings();
				})();
			});

			pill.createSpan({ cls: 'wl-tag-name', text: label });
		}
	}

	/**
	 * Reading status colours — the five fixed statuses, colour only (the names are a TS
	 * union). Values live in `ReadingSettings.statusColors`, keyed by status name.
	 */
	private renderReadingStatusColors(el: HTMLElement): void {
		const readingData = this.plugin.readingDataManager;
		this.renderTagListSection(el, {
			label: t('settings.tags.status'),
			info: t('settings.tags.infoStatusLocked'),
			display: (name) => readingStatusLabel(name as ReadingStatus),
			getList: () => READING_STATUSES.map((name) => ({
				name,
				color: readingStatusColor(name, readingData.getSettings().statusColors),
			})),
			setColor: async (name, color) => {
				const next = { ...(readingData.getSettings().statusColors ?? {}), [name]: color };
				// updateSettings saves + notifies, so the Reading tab repaints
				await readingData.updateSettings({ statusColors: next });
			},
			isLocked: () => true,
		});
	}

	/**
	 * Games statuses / genres / platforms. Statuses are colour-only — their names carry
	 * behaviour (the auto "To be released", "Finished" and manual TBA slots). Genres and
	 * platforms are fully editable.
	 *
	 * Games reference genres and platforms **by name**, so a rename must cascade into the
	 * game records and into any stored filter selections, or it orphans them.
	 */
	private renderGamesTags(el: HTMLElement, onChanged?: () => void): void {
		const gameData = this.plugin.gameDataManager;
		const settings = (): GamesSettings => gameData.getSettings();

		this.renderTagListSection(el, {
			label: t('settings.tags.status'),
			info: t('settings.tags.infoStatusLocked'),
			display: statusLabel,
			getList: () => settings().statuses,
			setColor: async (name, color) => {
				const tag = settings().statuses.find((t) => t.name === name);
				if (tag) tag.color = color;
				await gameData.updateSettings({ statuses: settings().statuses });
			},
			isLocked: () => true,
		});

		this.renderTagListSection(el, {
			label: t('settings.tags.genre'),
			onChanged,
			info: t('settings.tags.infoGenres'),
			getList: () => settings().types,
			setColor: async (name, color) => {
				const tag = settings().types.find((t) => t.name === name);
				if (tag) tag.color = color;
				await gameData.updateSettings({ types: settings().types });
			},
			add: async (name, color) => {
				settings().types.push({ name, color });
				await gameData.updateSettings({ types: settings().types });
			},
			remove: async (name) => {
				// watchlist type behaviour: the games keep their stored genre string (it still renders,
				// with a fallback colour) — only the configured entry goes away
				await gameData.updateSettings({
					types: settings().types.filter((t) => t.name !== name),
				});
				this.clearGamesFilterRefs('type', name);
			},
			rename: async (from, to) => {
				const tag = settings().types.find((t) => t.name === from);
				if (tag) tag.name = to;
				for (const g of gameData.getGames()) {
					if (g.type === from) g.type = to;
				}
				this.renameGamesFilterRefs('type', from, to);
				await gameData.updateSettings({ types: settings().types });
			},
		});

		this.renderTagListSection(el, {
			label: t('settings.tags.platform'),
			onChanged,
			info: t('settings.tags.infoPlatforms'),
			getList: () => settings().platforms,
			setColor: async (name, color) => {
				const tag = settings().platforms.find((t) => t.name === name);
				if (tag) tag.color = color;
				await gameData.updateSettings({ platforms: settings().platforms });
			},
			add: async (name, color) => {
				settings().platforms.push({ name, color });
				await gameData.updateSettings({ platforms: settings().platforms });
			},
			remove: async (name) => {
				// unlike genres, an orphaned platform name would be invisible (chips are drawn from this
				// list only), so strip it from the games too
				for (const g of gameData.getGames()) {
					if (g.platforms.includes(name)) {
						g.platforms = g.platforms.filter((p) => p !== name);
					}
				}
				await gameData.updateSettings({
					platforms: settings().platforms.filter((t) => t.name !== name),
				});
				this.clearGamesFilterRefs('platform', name);
			},
			rename: async (from, to) => {
				const tag = settings().platforms.find((t) => t.name === from);
				if (tag) tag.name = to;
				for (const g of gameData.getGames()) {
					if (g.platforms.includes(from)) {
						g.platforms = g.platforms.map((p) => (p === from ? to : p));
					}
				}
				this.renameGamesFilterRefs('platform', from, to);
				await gameData.updateSettings({ platforms: settings().platforms });
			},
		});

		el.createDiv({
			cls: 'wl-sg-note',
			text: t('settings.customize.games.note'),
		});
	}

	/** Live-filter + saved-preset exclusion lists referencing a genre/platform by name. */
	private gamesFilterRefs(kind: 'type' | 'platform'): string[][] {
		// the Games filter calls the genre axis `genreExclude` (the field on the game itself is
		// `type`), so the two names differ by design
		const key = kind === 'type' ? 'genreExclude' : 'platformExclude';
		const lists: string[][] = [];
		const live = this.plugin.settings.gamesFilters;
		if (live?.[key]) lists.push(live[key]);
		const preset = this.plugin.gameDataManager.getSettings().savedFilterPreset;
		if (preset?.[key]) lists.push(preset[key]);
		return lists;
	}

	/** Keeps stored "exclude this genre/platform" selections pointing at the new name. */
	private renameGamesFilterRefs(kind: 'type' | 'platform', from: string, to: string): void {
		for (const list of this.gamesFilterRefs(kind)) {
			const idx = list.indexOf(from);
			if (idx !== -1) list[idx] = to;
		}
		void this.plugin.saveSettings();
	}

	/**
	 * Drops a deleted genre/platform from stored filters — it would otherwise stay an active
	 * exclusion with no checkbox left to clear it.
	 */
	private clearGamesFilterRefs(kind: 'type' | 'platform', name: string): void {
		for (const list of this.gamesFilterRefs(kind)) {
			const idx = list.indexOf(name);
			if (idx !== -1) list.splice(idx, 1);
		}
		void this.plugin.saveSettings();
	}

	/** `onPicked` reports the selected theme's label so the group header chip can follow it. */
	private renderThemePicker(el: HTMLElement, onPicked?: (label: string) => void): void {
		const themes: Array<{ key: 'default' | 'nightfall' | 'bluez'; label: string; colors: string[] }> = [
			{
				key: 'default',
				label: t('settings.customize.theme.default'),
				colors: ['#1D9E75', '#378ADD', '#BA7517', '#7F77DD', '#E24B4A'],
			},
			{
				key: 'nightfall',
				label: 'Nightfall',
				colors: ['#10002B', '#3C096C', '#7B2CBF', '#C77DFF', '#E0AAFF'],
			},
			{
				key: 'bluez',
				label: 'Bluez',
				colors: ['#012A4A', '#01497C', '#2C7DA0', '#61A5C2', '#A9D6E5'],
			},
		];

		const currentTheme = this.plugin.settings.colorTheme ?? 'default';
		const cardsRow = el.createDiv({ cls: 'wl-theme-cards' });
		onPicked?.(themes.find((th) => th.key === currentTheme)?.label ?? t('settings.customize.theme.default'));

		const allCards: HTMLElement[] = [];
		for (const theme of themes) {
			const card = cardsRow.createDiv({
				cls: `wl-theme-card${currentTheme === theme.key ? ' is-selected' : ''}`,
			});
			allCards.push(card);
			card.createDiv({ cls: 'wl-theme-card-name', text: theme.label });
			const strip = card.createDiv({ cls: 'wl-theme-strip' });
			for (const color of theme.colors) {
				const swatch = strip.createDiv({ cls: 'wl-theme-swatch' });
				swatch.style.backgroundColor = color;
			}
			card.addEventListener('click', () => {
				void (async () => {
					this.plugin.settings.colorTheme = theme.key;
					await this.plugin.saveSettings();
					for (const c of allCards) c.removeClass('is-selected');
					card.addClass('is-selected');
					onPicked?.(theme.label);
					activeDocument.dispatchEvent(new CustomEvent('watchlog-data-changed'));
					const leaves = this.plugin.app.workspace.getLeavesOfType('watchlog-view');
					for (const leaf of leaves) {
						if (leaf.view instanceof WatchLogView) {
							leaf.view.refreshUI();
						}
					}
				})();
			});
		}
	}

	private renderSeasonColors(el: HTMLElement): void {
		const wrap = this.sgCard(el, {
			label: t('settings.customize.season.label'),
			help: t('settings.customize.season.help'),
		});

		const colorsEl = wrap.createDiv({ cls: 'wl-season-colors-list' });
		const renderColors = (): void => {
			colorsEl.empty();
			this.plugin.settings.seasonPalette.forEach((color, idx) => {
				const pill = colorsEl.createDiv({ cls: 'wl-season-color-pill' });
				const swatch = pill.createEl('input', {
					cls: 'wl-color-input',
					attr: { type: 'color', value: color },
				});
				swatch.addEventListener('change', () => {
					void (async () => {
						this.plugin.settings.seasonPalette[idx] = swatch.value;
						await this.plugin.saveSettings();
					})();
				});
				pill.createSpan({ cls: 'wl-season-color-label', text: t('settings.customize.season.name', { number: idx + 1 }) });
				const del = createIconButton(pill, {
					icon: 'x',
					label: t('settings.customize.season.remove', { number: idx + 1 }),
					cls: 'wl-tag-del',
					variant: 'sm',
				});
				del.addEventListener('click', () => {
					void (async () => {
						this.plugin.settings.seasonPalette.splice(idx, 1);
						await this.plugin.saveSettings();
						renderColors();
					})();
				});
			});
		};
		renderColors();

		const addRow = wrap.createDiv({ cls: 'wl-tag-add-row' });
		const colorInput = addRow.createEl('input', {
			cls: 'wl-color-input',
			attr: { type: 'color', value: '#888780' },
		});
		const addBtn = addRow.createEl('button', { cls: 'wl-btn wl-btn-success', text: t('settings.customize.season.add') });
		addBtn.addEventListener('click', () => {
			void (async () => {
				this.plugin.settings.seasonPalette.push(colorInput.value);
				await this.plugin.saveSettings();
				colorInput.value = '#888780';
				renderColors();
			})();
		});
	}

	private static readonly LOCKED_TYPES = ['Anime', 'Movie', 'TV Show'];

	/**
	 * One colour-picker-per-entry list section. Config-driven, so the same renderer serves
	 * lists in different stores: plugin settings, `data.games.settings`, and a plain colour
	 * record (Reading, whose names are a fixed union). Callers supply the accessors; this
	 * owns only the DOM.
	 */
	private renderTagListSection(parent: HTMLElement, cfg: TagListSectionConfig): void {
		const wrap = this.sgCard(parent, { label: cfg.label, help: cfg.info });

		const tagsEl = wrap.createDiv({ cls: 'wl-tags-list' });
		const renderTags = (): void => {
			tagsEl.empty();
			for (const tag of cfg.getList()) {
				this.renderTagListPill(tagsEl, tag, cfg, renderTags);
			}
			cfg.onChanged?.();
		};
		renderTags();

		if (cfg.add) {
			const addRow = wrap.createDiv({ cls: 'wl-tag-add-row' });
			const nameInput = addRow.createEl('input', {
				cls: 'wl-modal-input',
				attr: { type: 'text', placeholder: t('settings.tags.namePlaceholder') },
			});
			const colorInput = addRow.createEl('input', {
				cls: 'wl-color-input',
				attr: { type: 'color', value: '#888780' },
			});
			const addBtn = addRow.createEl('button', { cls: 'wl-btn wl-btn-success', text: t('settings.tags.add') });
			addBtn.addEventListener('click', () => {
				void (async () => {
					const name = nameInput.value.trim();
					if (!name) return;
					// names identify the entry everywhere (games store the name, not an id), so a duplicate
					// would make two rows indistinguishable
					if (cfg.getList().some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
						new Notice(t('settings.tags.exists', { name }));
						return;
					}
					const problem = cfg.validateName?.(name);
					if (problem) { new Notice(problem); return; }
					await cfg.add!(name, colorInput.value);
					nameInput.value = '';
					colorInput.value = '#888780';
					renderTags();
				})();
			});
		}
	}

	private renderTagListPill(
		parent: HTMLElement,
		tag: TagDefinition,
		cfg: TagListSectionConfig,
		refresh: () => void,
	): void {
		const pill = parent.createDiv({ cls: 'wl-tag-pill' });
		const locked = cfg.isLocked?.(tag.name) ?? false;

		const dotWrap = pill.createDiv({ cls: 'wl-tag-dot-wrap' });
		const dot = dotWrap.createSpan({ cls: 'wl-tag-dot' });
		dot.style.backgroundColor = tag.color;
		const colorPicker = dotWrap.createEl('input', {
			cls: 'wl-tag-color-picker',
			attr: { type: 'color', value: tag.color },
		});
		dot.addEventListener('click', () => colorPicker.click());
		colorPicker.addEventListener('change', () => {
			void (async () => {
				dot.style.backgroundColor = colorPicker.value;
				await cfg.setColor(tag.name, colorPicker.value);
			})();
		});

		if (cfg.rename && !locked) {
			// editable name; commits on change/blur, empty or duplicate reverts
			const nameInput = pill.createEl('input', {
				cls: 'wl-tag-name-input',
				attr: {
					type: 'text',
					value: tag.name,
					// sized to the current name, so "Xbox Series X|S" isn't cramped and short ones leave no
					// dead space
					size: String(Math.max(6, tag.name.length)),
					'aria-label': t('settings.tags.rename', { name: tag.name }),
				},
			});
			const original = tag.name;
			// `change` and `blur` both fire when committing with the mouse, and the rename is async —
			// without this guard the second call sees the new name already in the list and reports a
			// bogus "already exists"
			let committed = false;
			const commit = (): void => {
				if (committed) return;
				const next = nameInput.value.trim();
				if (!next || next === original) { nameInput.value = original; return; }
				if (cfg.getList().some((other) => other.name.toLowerCase() === next.toLowerCase())) {
					new Notice(t('settings.tags.exists', { name: next }));
					nameInput.value = original;
					return;
				}
				const problem = cfg.validateName?.(next);
				if (problem) { new Notice(problem); nameInput.value = original; return; }
				committed = true;
				void (async () => {
					await cfg.rename!(original, next);
					refresh();
				})();
			};
			nameInput.addEventListener('change', commit);
			nameInput.addEventListener('blur', commit);
		} else {
			pill.createSpan({ cls: 'wl-tag-name', text: cfg.display?.(tag.name) ?? tag.name });
		}

		if (cfg.remove && !locked) {
			const del = createIconButton(pill, {
				icon: 'x',
				label: t('settings.tags.remove', { name: tag.name }),
				cls: 'wl-tag-del',
				variant: 'sm',
			});
			del.addEventListener('click', () => {
				void (async () => {
					await cfg.remove!(tag.name);
					refresh();
					new Notice(t('settings.tags.removed', { name: tag.name }));
				})();
			});
		}
	}

	/** The three plugin-settings lists (Watchlist types/statuses, Priority). */
	private renderTagSection(
		parent: HTMLElement,
		label: string,
		key: 'types' | 'statuses' | 'priorities',
		onChanged?: () => void,
	): void {
		const isStatuses = key === 'statuses';
		const isTypes = key === 'types';
		const persist = async (): Promise<void> => { await this.plugin.saveSettings(); };

		this.renderTagListSection(parent, {
			label,
			onChanged,
			info: isStatuses
				? t('settings.tags.infoStatusLocked')
				: isTypes
					? t('settings.tags.infoTypes')
					: undefined,
			...(isStatuses ? { display: statusLabel } : {}),
			...(isTypes ? { display: typeLabel } : {}),
			getList: () => this.plugin.settings[key],
			setColor: async (name, color) => {
				const tag = this.plugin.settings[key].find((entry) => entry.name === name);
				if (tag) tag.color = color;
				await persist();
			},
			// statuses are colour-only; locked built-in types keep their picker but lose delete
			isLocked: (name) =>
				isStatuses || (isTypes && WatchLogSettingsTab.LOCKED_TYPES.includes(name)),
			...(isTypes ? { validateName: typeNameProblemText } : {}),
			...(isStatuses ? {} : {
				add: async (name, color) => {
					this.plugin.settings[key].push({ name, color });
					await persist();
				},
				remove: async (name) => {
					this.plugin.settings[key] = this.plugin.settings[key].filter((entry) => entry.name !== name);
					await persist();
				},
			}),
		});
	}

	// Folders

	private renderWatchlist(container: HTMLElement): void {
		const page = container.createDiv({ cls: 'wl-sg-page' });

		// main
		const el = this.settingsGroup(page, {
			title: t('settings.group.main'),
			sub: t('settings.watchlist.main.sub'),
			icon: 'clapperboard',
			variant: 'watchlist',
			rows: true,
		}).body;

		new Setting(el)
			.setName(t('settings.watchlist.numbering.name'))
			.setDesc(t('settings.watchlist.numbering.desc'))
			.addDropdown((d) =>
				d
					.addOptions({
						absolute: t('settings.watchlist.numbering.absolute'),
						'per-season': t('settings.watchlist.numbering.perSeason'),
					})
					.setValue(this.plugin.settings.episodeNumbering ?? 'absolute')
					.onChange(async (v) => {
						this.plugin.settings.episodeNumbering = v as 'absolute' | 'per-season';
						await this.plugin.saveSettings();
						activeDocument.dispatchEvent(new CustomEvent('watchlog-data-changed'));
					}),
			);

		new Setting(el)
			.setName(t('settings.watchlist.defaultType.name'))
			.setDesc(t('settings.watchlist.defaultType.desc'))
			.addDropdown((d) => {
				d.addOption(LAST_USED_TYPE_SENTINEL, t('settings.watchlist.defaultType.last'));
				for (const type of this.plugin.settings.types) {
					d.addOption(type.name, typeLabel(type.name));
				}
				d.setValue(this.plugin.settings.defaultAddType ?? LAST_USED_TYPE_SENTINEL).onChange(
					async (v) => {
						this.plugin.settings.defaultAddType = v;
						await this.plugin.saveSettings();
					},
				);
			});

		new Setting(el)
			.setName(t('settings.watchlist.topCredits.name'))
			.setDesc(t('settings.watchlist.topCredits.desc'))
			.addText((t) => {
				t.inputEl.type = 'number';
				t.inputEl.min = '1';
				t.inputEl.addClass('wl-settings-count-input');
				t.setValue(String(this.plugin.settings.dashboardTopCredits ?? 5)).onChange(
					async (v) => {
						const n = parseInt(v, 10);
						if (isNaN(n) || n < 1) return;
						this.plugin.settings.dashboardTopCredits = n;
						await this.plugin.saveSettings();
						activeDocument.dispatchEvent(new CustomEvent('watchlog-data-changed'));
					},
				);
			});

		new Setting(el)
			.setName(t('settings.watchlist.autoComplete.name'))
			.setDesc(t('settings.watchlist.autoComplete.desc'))
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoCompleteOnLastEpisode)
					.onChange(async (v) => {
						this.plugin.settings.autoCompleteOnLastEpisode = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(el)
			.setName(t('settings.watchlist.coloredBadges.name'))
			.setDesc(t('settings.watchlist.coloredBadges.desc'))
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.coloredTypeBadges)
					.onChange(async (v) => {
						this.plugin.settings.coloredTypeBadges = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(el)
			.setName(t('settings.watchlist.openAfterAdd.name'))
			.setDesc(t('settings.watchlist.openAfterAdd.desc'))
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.openWatchlistAfterAdd ?? true)
					.onChange(async (v) => {
						this.plugin.settings.openWatchlistAfterAdd = v;
						await this.plugin.saveSettings();
					}),
			);

		// import / export CSV
		const csv = this.settingsGroup(page, {
			title: t('settings.csv.title'),
			sub: t('settings.csv.watchlistSub'),
			icon: 'file-spreadsheet',
			variant: 'csv',
			rows: true,
		}).body;

		new Setting(csv)
.setName(t('settings.csv.exportName'))
			.setDesc(t('settings.csv.watchlistExportDesc'))
			.addButton((b) =>
				b.setButtonText(t('settings.csv.exportButton')).onClick(() => {
					new CsvModal(this.app, this.plugin, this.plugin.dataManager, 'export').open();
				}),
			);

		new Setting(csv)
.setName(t('settings.csv.importName'))
			.setDesc(t('settings.csv.watchlistImportDesc'))
			.addButton((b) =>
				b.setButtonText(t('settings.csv.importButton')).onClick(() => {
					new CsvModal(this.app, this.plugin, this.plugin.dataManager, 'import').open();
				}),
			);

		// folders
		const folders = this.settingsGroup(page, {
			title: t('settings.folders.title'),
			sub: t('settings.folders.sub'),
			icon: 'folder',
			variant: 'folders',
			rows: true,
		}).body;

		new Setting(folders)
			.setName(t('settings.folders.auto.name'))
			.setDesc(t('settings.folders.auto.desc'))
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoCreateFolders)
					.onChange(async (v) => {
						this.plugin.settings.autoCreateFolders = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(folders)
			.setName(t('settings.folders.createNow.name'))
			.setDesc(t('settings.folders.createNow.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.folders.createNow.button')).onClick(async () => {
					await this.plugin.dataManager.ensureFolders();
					new Notice(t('settings.folders.createNow.done'));
				}),
			);

		// type subfolders
		const subfolders = this.settingsGroup(page, {
			title: t('settings.folders.subfolders.title'),
			sub: t('settings.folders.subfolders.sub'),
			icon: 'folder-tree',
			variant: 'subfolders',
		});
		subfolders.setChip({
			text: t('settings.chip.types', { count: this.plugin.settings.types.length }),
			tone: 'count',
		});

		const listEl = subfolders.body.createDiv({ cls: 'wl-folder-list' });
		for (const type of this.plugin.settings.types) {
			const row = listEl.createDiv({ cls: 'wl-folder-row' });
			row.createSpan({ cls: 'wl-folder-type', text: typeLabel(type.name) });
			row.createSpan({
				cls: 'wl-folder-path',
				text: `${this.plugin.getLayout().root}/${type.name}`,
			});
		}
	}

	// Drafts

	private renderDrafts(container: HTMLElement): void {
		const page = container.createDiv({ cls: 'wl-sg-page' });

		// main
		const el = this.settingsGroup(page, {
			title: t('settings.group.main'),
			sub: t('settings.drafts.main.sub'),
			icon: 'notebook-pen',
			variant: 'drafts',
			rows: true,
		}).body;

		new Setting(el)
			.setName(t('settings.drafts.tag.name'))
			.setDesc(t('settings.drafts.tag.desc'))
			.addText((t) =>
				t
					.setPlaceholder('#watchlog')
					.setValue(this.plugin.settings.draftsVaultTag ?? '#watchlog')
					.onChange(async (v) => {
						this.plugin.settings.draftsVaultTag = v.trim() || '#watchlog';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(el)
			.setName(t('settings.drafts.after.name'))
			.setDesc(t('settings.drafts.after.desc'))
			.addDropdown((d) =>
				d
					.addOptions({ keep: t('settings.drafts.after.keep'), remove: t('common.remove') })
					.setValue(this.plugin.settings.draftsAfterAdding ?? 'keep')
					.onChange(async (v) => {
						this.plugin.settings.draftsAfterAdding = v as 'keep' | 'remove';
						await this.plugin.saveSettings();
					}),
			);
	}

	// Custom Lists

	private renderCustomLists(container: HTMLElement): void {
		const page = container.createDiv({ cls: 'wl-sg-page' });

		// main
		const el = this.settingsGroup(page, {
			title: t('settings.group.main'),
			sub: t('settings.lists.main.sub'),
			icon: 'table',
			variant: 'lists',
			rows: true,
		}).body;

		new Setting(el)
			.setName(t('settings.lists.columns.name'))
			.setDesc(t('settings.lists.columns.desc'))
			.addButton((b) => {
				const count = (this.plugin.settings.defaultCustomColumns ?? []).length;
				b.setButtonText(t('settings.lists.columns.button', { count }));
				b.onClick(() => {
					new DefaultColumnsModal(this.app, this.plugin).open();
				});
			});

		// folder
		const folder = this.settingsGroup(page, {
			title: t('settings.lists.folder.title'),
			sub: t('settings.lists.folder.sub'),
			icon: 'folder',
			variant: 'folders',
			rows: true,
		}).body;

		new Setting(folder)
			.setName(t('settings.lists.folder.name'))
			.setDesc(t('settings.lists.folder.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.folders.createNow.button')).onClick(async () => {
					const manager = new CustomListManager(this.app, this.plugin);
					await manager.ensureFolder();
					new Notice(t('settings.lists.folder.done'));
				}),
			);
	}

	// Reading

	private renderReading(container: HTMLElement): void {
		const readingData = this.plugin.readingDataManager;
		const settings = readingData.getSettings();
		const page = container.createDiv({ cls: 'wl-sg-page' });

		// main
		const main = this.settingsGroup(page, {
			title: t('settings.group.main'),
			sub: t('settings.reading.main.sub'),
			icon: 'book-open',
			variant: 'reading',
			rows: true,
		});
		main.setChip({
			text: this.chipJoin(
				t('settings.chip.books', { count: readingData.getBooks().length }),
				t('settings.chip.manga', { count: readingData.getMangaList().length }),
			),
			tone: 'count',
		});
		const el = main.body;

		new Setting(el)
			.setName(t('settings.reading.defaultStatus.name'))
			.setDesc(t('settings.reading.defaultStatus.desc'))
			.addDropdown((d) => {
				const opts: Record<string, string> = {};
				for (const status of SELECTABLE_READING_STATUSES) opts[status] = readingStatusLabel(status);
				d
					.addOptions(opts)
					.setValue(settings.defaultStatus)
					.onChange((v) => {
						void readingData.updateSettings({ defaultStatus: v as ReadingStatus });
					});
			});

		new Setting(el)
			.setName(t('settings.reading.subTab.name'))
			.setDesc(t('settings.reading.subTab.desc'))
			.addDropdown((d) => {
				d
					.addOptions({
						books: t('settings.reading.subTab.books'),
						manga: t('settings.reading.subTab.manga'),
					})
					.setValue(settings.defaultSubTab ?? 'books')
					.onChange((v) => {
						void readingData.updateSettings({ defaultSubTab: v as 'books' | 'manga' });
					});
			});

		// import / export CSV
		const csv = this.settingsGroup(page, {
			title: t('settings.csv.title'),
			sub: t('settings.csv.readingSub'),
			icon: 'file-spreadsheet',
			variant: 'csv',
			rows: true,
		}).body;

		new Setting(csv)
.setName(t('settings.csv.exportName'))
			.setDesc(t('settings.csv.readingExportDesc'))
			.addButton((b) =>
				b.setButtonText(t('settings.csv.exportButton')).onClick(() => {
					new ReadingCsvChoiceModal(this.app, 'export', (kind) => {
						new ReadingCsvModal(this.app, this.plugin, kind, 'export').open();
					}).open();
				}),
			);

		new Setting(csv)
.setName(t('settings.csv.importName'))
			.setDesc(t('settings.csv.readingImportDesc'))
			.addButton((b) =>
				b.setButtonText(t('settings.csv.importButton')).onClick(() => {
					new ReadingCsvChoiceModal(this.app, 'import', (kind) => {
						new ReadingCsvModal(this.app, this.plugin, kind, 'import').open();
					}).open();
				}),
			);
	}

	// Quick Info

	private renderQuickInfo(el: HTMLElement): void {
		el.createDiv({ cls: 'wl-settings-section-title', text: t('settings.nav.quickInfo') });

		// emoji stay in code; heading/body are keys of settings.quickInfo
		const sections: { icon: string; title: TranslationKey; items: { heading: TranslationKey; body: TranslationKey }[] }[] = [
			{
				icon: '📊',
				title: 'app.tabs.dashboard',
				items: [
					{ heading: 'settings.quickInfo.dashboard.note.heading', body: 'settings.quickInfo.dashboard.note.body' },
					{ heading: 'settings.quickInfo.dashboard.watched.heading', body: 'settings.quickInfo.dashboard.watched.body' },
					{ heading: 'settings.quickInfo.dashboard.remaining.heading', body: 'settings.quickInfo.dashboard.remaining.body' },
					{ heading: 'settings.quickInfo.dashboard.dropped.heading', body: 'settings.quickInfo.dashboard.dropped.body' },
				],
			},
			{
				icon: '📋',
				title: 'app.tabs.watchlist',
				items: [
					{ heading: 'settings.quickInfo.watchlist.groups.heading', body: 'settings.quickInfo.watchlist.groups.body' },
					{ heading: 'settings.quickInfo.watchlist.rating.heading', body: 'settings.quickInfo.watchlist.rating.body' },
					{ heading: 'settings.quickInfo.watchlist.pin.heading', body: 'settings.quickInfo.watchlist.pin.body' },
					{ heading: 'settings.quickInfo.watchlist.season.heading', body: 'settings.quickInfo.watchlist.season.body' },
				],
			},
			{
				icon: '🔍',
				title: 'settings.quickInfo.api.title',
				items: [
					{ heading: 'settings.quickInfo.api.which.heading', body: 'settings.quickInfo.api.which.body' },
				],
			},
			{
				icon: '📚',
				title: 'app.tabs.reading',
				items: [
					{ heading: 'settings.quickInfo.reading.booksManga.heading', body: 'settings.quickInfo.reading.booksManga.body' },
					{ heading: 'settings.quickInfo.reading.statuses.heading', body: 'settings.quickInfo.reading.statuses.body' },
					{ heading: 'settings.quickInfo.reading.progress.heading', body: 'settings.quickInfo.reading.progress.body' },
					{ heading: 'settings.quickInfo.reading.notes.heading', body: 'settings.quickInfo.reading.notes.body' },
					{ heading: 'settings.quickInfo.reading.covers.heading', body: 'settings.quickInfo.reading.covers.body' },
					{ heading: 'settings.quickInfo.reading.columns.heading', body: 'settings.quickInfo.reading.columns.body' },
				],
			},
			{
				icon: '📅',
				title: 'app.tabs.upcoming',
				items: [
					{ heading: 'settings.quickInfo.upcoming.how.heading', body: 'settings.quickInfo.upcoming.how.body' },
				],
			},
		];

		for (const section of sections) {
			const wrapper = el.createDiv({ cls: 'wl-qi-section' });

			const header = wrapper.createDiv({ cls: 'wl-qi-section-header' });
			const chevron = header.createSpan({ cls: 'wl-qi-chevron', text: '▶' });
			header.createSpan({ cls: 'wl-qi-section-label', text: `${section.icon} ${t(section.title)}` });

			const body = wrapper.createDiv({ cls: 'wl-qi-section-body wl-qi-section-body-hidden' });

			for (const item of section.items) {
				const banner = body.createDiv({ cls: 'wl-qi-banner' });
				banner.createDiv({ cls: 'wl-qi-banner-heading', text: t(item.heading) });
				banner.createDiv({ cls: 'wl-qi-banner-body', text: t(item.body) });
			}

			header.addEventListener('click', () => {
				const isOpen = !body.hasClass('wl-qi-section-body-hidden');
				if (isOpen) { body.addClass('wl-qi-section-body-hidden'); } else { body.removeClass('wl-qi-section-body-hidden'); }
				chevron.textContent = isOpen ? '▶' : '▼';
			});
		}
	}

	// Widgets

	private renderWidgets(el: HTMLElement): void {
		el.createDiv({
			cls: 'wl-settings-info',
			text: t('settings.widgets.intro', { command: `WatchLog: ${t('app.commands.insertWidget')}` }),
		});

		const widgets = [
			{
				name: 'wl-todo',
				desc: t('settings.widgets.todo'),
				syntax: '```wl-todo\nTitle Name\nmini\n```',
			},
			{
				name: 'wl-todo (full)',
				desc: t('settings.widgets.todoFull'),
				syntax: '```wl-todo\nTitle Name\n```',
			},
			{
				name: 'wl-stat: completed',
				desc: t('settings.widgets.statCompleted'),
				syntax: '```wl-stat\ncompleted\n```',
			},
			{
				name: 'wl-stat: time',
				desc: t('settings.widgets.statTime'),
				syntax: '```wl-stat\ntime\n```',
			},
			{
				name: 'wl-upcoming: next',
				desc: t('settings.widgets.upcomingNext'),
				syntax: '```wl-upcoming\nnext\n```',
			},
			{
				name: 'wl-nowwatching',
				desc: t('settings.widgets.nowWatching'),
				syntax: '```wl-nowwatching\n```',
			},
			{
				name: 'wl-stat: time completed full',
				desc: t('settings.widgets.statTimeCompletedFull'),
				syntax: '```wl-stat\ntime completed full\n```',
			},
			{
				name: 'wl-now-next',
				desc: t('settings.widgets.nowNext'),
				syntax: '```wl-now-next\n```',
			},
		];

		for (const w of widgets) {
			const section = el.createDiv({ cls: 'wl-widget-info-section' });
			section.createDiv({ cls: 'wl-widget-info-name', text: w.name });
			section.createDiv({ cls: 'wl-widget-info-desc', text: w.desc });
			const codeRow = section.createDiv({ cls: 'wl-widget-info-code-row' });
			codeRow.createEl('code', { cls: 'wl-widget-info-code', text: w.syntax });
			const copyBtn = codeRow.createEl('button', { cls: 'wl-btn wl-btn-sm', text: t('settings.widgets.copy') });
			copyBtn.addEventListener('click', () => {
				void navigator.clipboard.writeText(w.syntax).then(() => {
					copyBtn.textContent = t('settings.widgets.copied');
					window.setTimeout(() => { copyBtn.textContent = t('settings.widgets.copy'); }, 1500);
				});
			});
		}
	}
}

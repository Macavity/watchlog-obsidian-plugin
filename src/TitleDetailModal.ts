import { App, Modal, Notice, Platform, setIcon } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { WatchLogTitle, WatchLogGroup, Season, TagDefinition, CreditsField } from './types';
import { formatTime, todayIso, getThemedColor, getDisplayPoster, getDisplayTrailer, getApiGroupForType, getTitleCredits, getManualCredits, isCreditsUnfetched, needsCreditsFetch, needsStudioFetch, CREDITS_NONE, CREDITS_INLINE_LIMIT, STUDIO_INLINE_LIMIT } from './types';
import { createDatePicker } from './DatePicker';
import type { DatePickerHandle } from './DatePicker';
import { AddCreditModal } from './AddCreditModal';
import { appendNoteLinkButton } from './NoteLinkButton';
import { appendMarkWatchedButton, isSingleEpisodeTitle } from './MarkWatchedButton';
import { EditTitleModal } from './EditTitleModal';
import { ConfirmModal } from './ConfirmModal';
import { renderCommunityRating, maybeAutoRefreshCommunityRating } from './CommunityRating';
import { renderTagPill } from './StatusDropdown';
import { renderStarRating } from './StarRating';
import { CollectionModal, resolveCollection, countMissing } from './CollectionModal';
import { pinModalFooter } from './StickyModal';
import { renderEpisodeGrid } from './ui/EpisodeGrid';
import type { TmdbCollectionDetail } from './types';
import { t } from './i18n';
import { paintFavoriteButton, renderGroupDetailHeader, episodeGridText } from './ui/detailShared';
import { statusLabel, typeLabel } from './i18n/labels';

// titles whose credits backfill is in flight — de-dupes rapid modal re-opens
const creditsBackfillInFlight = new Set<string>();
const studioBackfillInFlight = new Set<string>();

export class TitleDetailModal extends Modal {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private title: WatchLogTitle;
	private onChanged?: () => void;
	private onPersonClick?: (name: string) => void;
	private changed = false;
	private notesEditedByUser = false;
	private collapsedSeasons: Set<number> = new Set();
	// phone layout: poster + title/rating on top, everything else full width below
	private mobile = false;

	// section anchors for incremental re-renders
	private headerEl: HTMLElement | null = null;
	private footerEl: HTMLElement | null = null;
	private studioEl: HTMLElement | null = null;
	private statsBoxEl: HTMLElement | null = null;
	private creditsEl: HTMLElement | null = null;
	private episodesSectionEl: HTMLElement | null = null;
	private starsWrapEl: HTMLElement | null = null;
	private statusWrapEl: HTMLElement | null = null;
	private datePickerEl: DatePickerHandle | null = null;
	private refreshDateDimmed: (() => void) | null = null;

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		title: WatchLogTitle,
		onChanged?: () => void,
		onPersonClick?: (name: string) => void,
	) {
		super(app);
		this.plugin = plugin;
		this.dataManager = plugin.dataManager;
		this.title = title;
		this.onChanged = onChanged;
		this.onPersonClick = onPersonClick;
		this.collapsedSeasons = this.dataManager.getCollapsedSeasonsForTitle(title.id);
	}

	onOpen(): void {
		const colorTheme = this.plugin.settings.colorTheme ?? 'default';
		// theme vars are scoped to `.wl-view` / `.wl-view[data-theme=…]` — mark the content root with both
		// so episode boxes, stars and progress bars pick up the active theme
		this.modalEl.setAttribute('data-theme', colorTheme);
		this.contentEl.setAttribute('data-theme', colorTheme);
		this.contentEl.addClass('wl-view');
		this.contentEl.addClass('wl-detail-modal');
		this.mobile = Platform.isMobile;
		this.contentEl.toggleClass('wl-detail-mobile', this.mobile);
		this.renderAll();
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.changed && this.onChanged) {
			this.onChanged();
		}
	}

	private getTagDef(name: string, list: TagDefinition[]): TagDefinition | undefined {
		return list.find((d) => d.name === name);
	}

	private refreshTitle(): void {
		const fresh = this.dataManager.getTitle(this.title.id);
		if (fresh) this.title = fresh;
	}

	private markChanged(): void {
		this.changed = true;
	}

	private renderAll(): void {
		this.contentEl.empty();
		this.renderHeader(this.contentEl);
		this.renderEpisodesSection(this.contentEl);
		// mobile puts the rating row inside the header, beside the poster
		if (!this.mobile) this.renderRatingSection(this.contentEl);
		this.renderNotesSection(this.contentEl);
		this.renderDateSection(this.contentEl);
		this.renderFooter(this.contentEl);
		pinModalFooter(this.footerEl);
	}

	// Header
	private renderHeader(parent: HTMLElement): void {
		this.headerEl = parent.createDiv({ cls: 'wl-detail-header' });
		this.renderHeaderBody();
	}

	/**
	 * Rebuilds the header in place, after a rename or a type change — both ripple beyond their own
	 * control (the note path the "Open note" button resolved, the placeholder colour).
	 */
	private renderHeaderBody(): void {
		const header = this.headerEl;
		if (!header) return;
		header.empty();
		const mobile = this.mobile;

		// mobile: poster + title/stars share a top row; the rest spans the modal width below it
		const top = mobile ? header.createDiv({ cls: 'wl-detail-header-top' }) : header;

		// cover on the left, mirroring ReadingTab's in-flow aspect-ratio box
		this.renderCover(top);

		const left = top.createDiv({ cls: 'wl-detail-header-left' });
		// inline-editable title: click to swap in an input, commit on blur or Enter, Escape aborts
		const titleWrap = left.createDiv({ cls: 'wl-detail-title-wrap' });
		this.renderTitleDisplay(titleWrap);

		if (mobile) {
			// stars + community rating ride beside the poster; studio joins the credits grid instead
			this.studioEl = null;
			this.renderRatingSection(left);
		} else {
			this.studioEl = left.createDiv({ cls: 'wl-detail-studio' });
			this.renderStudioLine();
		}

		// full width under the poster on mobile, stacked beside it on desktop
		const body = mobile ? header : left;

		const badgeRow = body.createDiv({ cls: 'wl-detail-badge-row' });

		// editable type badge — the status/priority pill + dropdown, over the configured types
		const typeWrap = badgeRow.createSpan({ cls: 'wl-reading-detail-status-wrap' });
		this.renderTypeBadge(typeWrap);

		// badge row: Type · Status · Priority · globe · note — the link icons trail the pills.
		// editable status badge, over the user-configured statuses and their colors.
		const statusWrap = badgeRow.createSpan({ cls: 'wl-reading-detail-status-wrap' });
		this.statusWrapEl = statusWrap;
		this.renderStatusBadge(statusWrap);

		// editable priority badge; a muted placeholder pill when none is set
		const priorityWrap = badgeRow.createSpan({ cls: 'wl-reading-detail-status-wrap' });
		this.renderPriorityBadge(priorityWrap);

		if (this.title.externalLink) {
			const linkIcon = badgeRow.createEl('a', { cls: 'wl-acc-link-icon' });
			// mobile renders the row as icon buttons — an emoji beside two lucide glyphs reads wrong
			if (mobile) setIcon(linkIcon, 'globe');
			else linkIcon.setText('🌐');
			linkIcon.href = this.title.externalLink;
			linkIcon.title = t('list.openExternalLink');
			linkIcon.target = '_blank';
			linkIcon.rel = 'noopener noreferrer';
		}

		// open the per-title .md note; the shared helper builds the button and handles failure
		appendNoteLinkButton(
			this.app,
			badgeRow,
			this.dataManager.getNoteFilePath(this.title),
			() => this.close(),
		);

		// mobile parks the credits refresh here as a third icon button
		if (mobile) this.renderCreditsRefreshButton(badgeRow);

		// the -bar variant lays the four stats over a full-width bar and shrinks to content; the plain box
		// (group modals) keeps its row layout. Mobile drops the box for a plain stat line.
		this.statsBoxEl = body.createDiv({
			cls: mobile ? 'wl-detail-stats-line' : 'wl-detail-stats-box wl-detail-stats-box-bar',
		});
		this.renderStatsBox();

		// credits rows; missing fields kick off the one-time backfill and re-render when it lands
		this.creditsEl = body.createDiv({ cls: 'wl-detail-credits' });
		this.renderCreditsSection();
		this.maybeBackfillCredits();
		this.maybeBackfillStudio();
	}

	// Inline-editable title
	private renderTitleDisplay(wrap: HTMLElement): void {
		wrap.empty();
		const titleEl = wrap.createEl('h2', {
			cls: 'wl-detail-title wl-reading-detail-editable-text',
			text: this.title.title,
		});
		titleEl.title = t('detail.clickToEdit');
		titleEl.addEventListener('click', () => this.editTitleInline(wrap));
	}

	private editTitleInline(wrap: HTMLElement): void {
		wrap.empty();
		const input = wrap.createEl('input', {
			cls: 'wl-modal-input wl-detail-title-input',
			attr: { type: 'text' },
		});
		input.value = this.title.title;
		let done = false;
		const commit = (): void => {
			if (done) return;
			done = true;
			const val = input.value.trim();
			const curr = this.dataManager.getTitle(this.title.id);
			if (!val || !curr || val === curr.title) {
				this.renderTitleDisplay(wrap);
				return;
			}
			void (async () => {
				curr.title = val;
				// moves the note file too — updateMarkdownFile trashes the path it last wrote for this id
				await this.dataManager.updateTitle(curr);
				this.refreshTitle();
				this.markChanged();
				// the note-link button captured the old path; rebuild the header
				this.renderHeaderBody();
			})();
		};
		input.addEventListener('blur', commit);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				input.blur();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				done = true;
				this.renderTitleDisplay(wrap);
			}
		});
		input.focus();
		input.select();
	}

	// Type
	private typeColor(name: string): string {
		const def = this.getTagDef(name, this.plugin.settings.types);
		return def
			? getThemedColor(name, def.color, this.plugin.settings.colorTheme)
			: '#888780';
	}

	private renderTypeBadge(wrap: HTMLElement): void {
		renderTagPill({
			wrap,
			value: this.title.type,
			valueLabel: typeLabel(this.title.type),
			color: this.typeColor(this.title.type),
			tooltip: t('detail.clickToChangeType'),
			container: this.contentEl,
			options: this.plugin.settings.types.map((def) => ({ value: def.name, label: typeLabel(def.name) })),
			getOptionColor: (name) => this.typeColor(name),
			onSelect: (name) => void this.saveType(name),
		});
	}

	private async saveType(type: string): Promise<void> {
		const t = this.dataManager.getTitle(this.title.id);
		if (!t || t.type === type) return;
		t.type = type;
		await this.dataManager.updateTitle(t);
		this.refreshTitle();
		this.markChanged();
		// the type drives the note folder and the placeholder colour, so the whole header is rebuilt
		this.renderHeaderBody();
	}

	// Credits (director / cast)
	private renderCreditsSection(): void {
		if (!this.creditsEl) return;
		this.creditsEl.empty();
		// mobile keeps the refresh in the badge row
		if (!this.mobile) this.renderCreditsRefreshButton(this.creditsEl);
		renderCreditsRows(this.creditsEl, this.title, {
			includeStudio: this.mobile,
			onPersonClick: this.onPersonClick
				? (name) => {
					this.close();
					this.onPersonClick!(name);
				}
				: undefined,
			onAddCredits: (field) => this.openAddCredits(field),
			onRemoveManual: (field, name) => void this.removeManualCredit(field, name),
		});
	}

	private openAddCredits(field: CreditsField): void {
		new AddCreditModal(this.app, this.plugin, this.title, field, () => {
			this.markChanged();
			this.refreshTitle();
			this.renderCreditsSection();
		}).open();
	}

	private async removeManualCredit(field: CreditsField, name: string): Promise<void> {
		const remaining = getManualCredits(this.title, field).filter(
			(n) => n.toLowerCase() !== name.toLowerCase(),
		);
		await this.dataManager.updateManualCredits(this.title.id, field, remaining);
		this.markChanged();
		this.refreshTitle();
		this.renderCreditsSection();
	}

	private renderCreditsRefreshButton(parent: HTMLElement): void {
		renderCreditsRefreshButton(parent, this.plugin, this.title, (changed) => {
			if (changed) this.markChanged();
			this.refreshTitle();
			this.renderCreditsSection();
		});
	}

	/**
	 * One-time credits backfill for titles predating the fields. Fetches from the stored IMDb link and
	 * stores the result in the cache only; the note is never written. A failed or empty fetch marks
	 * the fields 'none' so no later open retries.
	 */
	private maybeBackfillCredits(): void {
		const t = this.dataManager.getTitle(this.title.id);
		if (!t || !needsCreditsFetch(t) || creditsBackfillInFlight.has(t.id)) return;
		creditsBackfillInFlight.add(t.id);
		void (async () => {
			try {
				const fetched = await this.plugin.apiService.fetchCredits(
					t,
					this.plugin.settings.activeApi ?? 'OMDb',
				);
				// only absent fields are filled; data or a 'none' marker is kept as-is
				const director = isCreditsUnfetched(t.director) ? (fetched?.director ?? [CREDITS_NONE]) : t.director!;
				const cast = isCreditsUnfetched(t.cast) ? (fetched?.cast ?? [CREDITS_NONE]) : t.cast!;
				await this.dataManager.updateCredits(t.id, director, cast);
			} catch {
				// persistence failed — fields stay unfetched, so the next open retries
			} finally {
				creditsBackfillInFlight.delete(t.id);
			}
			this.refreshTitle();
			this.renderCreditsSection();
		})();
	}

	/** Studio is a credits row on mobile, chips under the title on desktop. */
	private refreshStudioDisplay(): void {
		if (this.mobile) this.renderCreditsSection();
		else this.renderStudioLine();
	}

	/** Studio chips under the title; STUDIO_INLINE_LIMIT shown, rest behind "+N more". */
	private renderStudioLine(): void {
		const wrap = this.studioEl;
		if (!wrap) return;
		wrap.empty();
		const names = getTitleCredits(this.title, 'studio');
		if (names.length === 0) {
			wrap.addClass('wl-hidden');
			return;
		}
		wrap.removeClass('wl-hidden');

		const chip = (name: string): void => {
			const el = wrap.createSpan({ cls: 'wl-detail-studio-chip', text: name });
			if (!this.onPersonClick) return;
			el.addClass('is-clickable');
			el.title = t('detail.filterBy', { name });
			el.addEventListener('click', () => {
				this.close();
				this.onPersonClick!(name);
			});
		};

		names.slice(0, STUDIO_INLINE_LIMIT).forEach(chip);
		const overflow = names.slice(STUDIO_INLINE_LIMIT);
		if (overflow.length === 0) return;

		const more = wrap.createSpan({
			cls: 'wl-detail-studio-more',
			text: t('detail.more', { count: overflow.length }),
		});
		more.addEventListener('click', () => {
			more.remove();
			overflow.forEach(chip);
		});
	}

	/** One-time studio backfill; a miss stores 'none' so no later open retries. */
	private maybeBackfillStudio(): void {
		const t = this.dataManager.getTitle(this.title.id);
		if (!t || !needsStudioFetch(t) || studioBackfillInFlight.has(t.id)) return;
		studioBackfillInFlight.add(t.id);
		void (async () => {
			try {
				const group = getApiGroupForType(t.type, this.plugin.settings.typeApiMapping);
				const found = await this.plugin.apiService.fetchStudio(
					t,
					this.plugin.settings.animeApiSource ?? 'jikan',
					group,
				);
				await this.dataManager.updateStudio(
					t.id,
					found?.studio ?? [CREDITS_NONE],
					found?.tmdbId,
					found?.tmdbMediaType,
				);
			} catch {
				// stays unfetched, so the next open retries
			} finally {
				studioBackfillInFlight.delete(t.id);
			}
			this.refreshTitle();
			this.refreshStudioDisplay();
		})();
	}

	// cover box mirroring the Cards view: the resolved poster (manual or auto), else the type-coloured
	// letter placeholder. Reserves its aspect-ratio space from first paint.
	private renderCover(parent: HTMLElement): void {
		const cover = parent.createDiv({ cls: 'wl-detail-cover' });
		const typeDef = this.getTagDef(this.title.type, this.plugin.settings.types);
		const typeColor = typeDef
			? getThemedColor(this.title.type, typeDef.color, this.plugin.settings.colorTheme)
			: '#888780';

		const placeholder = cover.createDiv({ cls: 'wl-detail-cover-placeholder' });
		placeholder.style.backgroundColor = typeColor;
		const letter = (this.title.title.trim().charAt(0) || '?').toUpperCase();
		placeholder.createSpan({ text: letter });

		const img = cover.createEl('img', { cls: 'wl-detail-cover-img' });
		img.alt = this.title.title;

		const showImg = (url: string): void => {
			img.src = url;
			cover.addClass('has-poster');
		};
		const showPlaceholder = (): void => {
			cover.removeClass('has-poster');
		};

		const display = getDisplayPoster(this.title);
		if (display && display.startsWith('http')) {
			showImg(display);
			img.onerror = () => {
				showPlaceholder();
				void this.dataManager.updatePosterUrl(this.title.id, 'none');
			};
		} else if (this.title.posterUrl === '') {
			placeholder.addClass('is-loading');
			void this.plugin.posterService?.enqueue(this.title).then((url) => {
				placeholder.removeClass('is-loading');
				if (url) showImg(url);
			});
		}
	}

	private renderStatsBox(): void {
		if (!this.statsBoxEl) return;
		this.statsBoxEl.empty();
		const entry = this.title;
		const timeLeft = this.dataManager.calcTimeRemainingForModal(entry);
		const timeWatched = this.dataManager.calcTimeWatched(entry);
		const watchedEps = entry.watchedEpisodes.length;
		const effectiveTotal = this.dataManager.getEffectiveTotal(entry);
		const progress = this.dataManager.getProgress(entry);

		// mobile: plain "2h 15m left · 0m watched · 0/1 eps" line, then a full-width bar and its caption
		if (this.mobile) {
			const line = this.statsBoxEl.createDiv({ cls: 'wl-detail-statline' });
			const stat = (value: string, label: string): void => {
				const item = line.createSpan({ cls: 'wl-detail-statline-item' });
				item.createSpan({ cls: 'wl-detail-statline-value', text: value });
				item.createSpan({ cls: 'wl-detail-statline-label', text: label });
			};
			stat(formatTime(timeLeft), t('list.stat.left'));
			stat(formatTime(timeWatched), t('list.stat.watched'));
			stat(`${watchedEps}/${effectiveTotal}`, t('detail.epsShort'));

			const bar = this.statsBoxEl.createDiv({ cls: 'wl-acc-progress-wrap' });
			bar.createDiv({ cls: 'wl-progress-bar' }).style.width = `${progress}%`;
			this.statsBoxEl.createDiv({
				cls: 'wl-detail-progress-label',
				text: t('detail.progressPercent', { percent: progress }),
			});
			return;
		}

		// the bar is a sibling of the stats row, not a child of the progress block, so it spans the full
		// box width instead of a 70px stub under "progress"
		const row = this.statsBoxEl.createDiv({ cls: 'wl-detail-stats-row' });

		const makeBlock = (value: string, label: string): void => {
			const block = row.createDiv({ cls: 'wl-acc-stat-block' });
			block.createDiv({ cls: 'wl-acc-percent', text: value });
			block.createDiv({ cls: 'wl-acc-progress-label', text: label });
		};
		makeBlock(formatTime(timeLeft), t('list.stat.left'));
		makeBlock(formatTime(timeWatched), t('list.stat.watched'));
		makeBlock(`${watchedEps} / ${effectiveTotal}`, t('list.stat.episodes'));

		const progBlock = row.createDiv({ cls: 'wl-acc-header-right' });
		progBlock.createDiv({ cls: 'wl-acc-percent', text: `${progress}%` });
		progBlock.createDiv({ cls: 'wl-acc-progress-label', text: t('list.stat.progress') });

		const barWrap = this.statsBoxEl.createDiv({
			cls: 'wl-acc-progress-wrap wl-detail-stats-bar',
		});
		barWrap.createDiv({ cls: 'wl-progress-bar' }).style.width = `${progress}%`;
	}

	// repaint the header pill / date-watched so a Mark-as-Watched press shows without reopening
	private renderStatusBadgeInPlace(): void {
		if (this.statusWrapEl) this.renderStatusBadge(this.statusWrapEl);
	}

	private renderDateInPlace(): void {
		if (!this.datePickerEl) return;
		// silent: the value already comes from the persisted title
		this.datePickerEl.setValue(this.title.dateFinished, true);
		this.refreshDateDimmed?.();
	}

	// Episodes / Seasons
	private renderEpisodesSection(parent: HTMLElement): void {
		this.episodesSectionEl = parent.createDiv({ cls: 'wl-detail-episodes' });
		this.renderEpisodesBody();
	}

	private renderEpisodesBody(): void {
		if (!this.episodesSectionEl) return;
		this.episodesSectionEl.empty();
		const entry = this.title;
		if (isSingleEpisodeTitle(entry)) {
			const row = this.episodesSectionEl.createDiv({ cls: 'wl-movie-row' });
			// the shared toggle owns the status → Completed and watch-date writes; this only mirrors them back
			// into the open modal
			appendMarkWatchedButton(this.dataManager, row, entry.id, () => {
				this.refreshTitle();
				this.markChanged();
				this.renderStatsBox();
				this.renderStatusBadgeInPlace();
				this.renderDateInPlace();
			});
			return;
		}
		if (entry.seasons.length === 0) {
			if (entry.totalEpisodes > 0) {
				this.renderEpisodeGrid(this.episodesSectionEl, null);
			}
			return;
		}
		entry.seasons.forEach((season, seasonIdx) => {
			let isCollapsed = this.collapsedSeasons.has(seasonIdx);
			const seasonWrap = this.episodesSectionEl!.createDiv({ cls: 'wl-season-wrap' });
			const seasonHeader = seasonWrap.createDiv({ cls: 'wl-season-header' });
			const badge = seasonHeader.createSpan({ cls: 'wl-season-badge' });
			badge.textContent = season.name;
			const palette = this.plugin.settings.seasonPalette;
			badge.style.backgroundColor = palette[seasonIdx % palette.length] ?? '#888780';
			const skipCount = (season.skippedEpisodes ?? []).length;
			seasonHeader.createSpan({
				cls: 'wl-season-ep-count',
				text: skipCount > 0
					? t('list.season.epsToSkip', { eps: season.episodes, skip: skipCount })
					: t('list.season.eps', { count: season.episodes }),
			});
			const chevron = seasonHeader.createSpan({
				cls: `wl-chevron${isCollapsed ? '' : ' is-open'}`,
				text: '›',
			});

			if (!isCollapsed) {
				this.renderEpisodeGrid(seasonWrap, season);
			}

			seasonHeader.addEventListener('click', () => {
				if (isCollapsed) {
					isCollapsed = false;
					this.collapsedSeasons.delete(seasonIdx);
					chevron.classList.add('is-open');
					this.renderEpisodeGrid(seasonWrap, season);
				} else {
					isCollapsed = true;
					this.collapsedSeasons.add(seasonIdx);
					chevron.classList.remove('is-open');
					seasonWrap.querySelector('.wl-episode-grid')?.remove();
				}
				void this.dataManager.persistCollapsedSeasons(this.title.id, this.collapsedSeasons);
			});
		});
	}

	private renderEpisodeGrid(parent: HTMLElement, season: Season | null): void {
		renderEpisodeGrid(parent, {
			getTitle: () => this.title,
			season,
			perSeason: this.plugin.settings.episodeNumbering === 'per-season',
			...episodeGridText(),
			onFill: (seasonEps, markWatched) => {
				void this.dataManager
					.markSeasonWatched(this.title.id, seasonEps, markWatched, season?.name)
					.then(() => {
						this.refreshTitle();
						this.markChanged();
						this.renderEpisodesBody();
						this.renderStatsBox();
					});
			},
			onEpisode: (epNum, _e, refreshBox, refreshFillBtn) => {
				const isWatched = this.title.watchedEpisodes.includes(epNum);
				this.dataManager.applyEpisodeWatchedToggle(this.title.id, epNum, !isWatched);
				this.refreshTitle();
				this.markChanged();
				refreshBox();
				refreshFillBtn();
				this.renderStatsBox();
			},
		});
	}

	// Rating
	private renderRatingSection(parent: HTMLElement): void {
		const mobile = this.mobile;
		const wrap = parent.createDiv({ cls: 'wl-detail-rating' });
		// no "Rating" label on mobile — stars carry their own tier label
		if (mobile) wrap.addClass('wl-detail-rating-stacked');
		else wrap.createSpan({ cls: 'wl-stars-label', text: t('list.footer.rating') });
		this.starsWrapEl = wrap.createDiv({ cls: 'wl-stars wl-detail-stars' });
		this.renderStars();

		// mobile drops the community badge + trailer onto their own line under the stars
		const commHost = mobile ? wrap.createDiv({ cls: 'wl-detail-community-row' }) : wrap;

		const rerenderCommunity = (): void => {
			if (mobile) {
				commHost.empty();
			} else {
				const next = wrap.querySelector('.wl-rating-divider');
				let n: ChildNode | null = next;
				while (n) {
					const toRemove = n;
					n = n.nextSibling;
					toRemove.parentNode?.removeChild(toRemove);
				}
			}
			renderCommunityRating(commHost, this.plugin, this.title.id, rerenderCommunity);
			this.renderTrailerControl(commHost);
			this.refreshTitle();
		};
		renderCommunityRating(commHost, this.plugin, this.title.id, rerenderCommunity);
		// trailer at the tail of the row: rating badge → refresh → YouTube
		this.renderTrailerControl(commHost);
		maybeAutoRefreshCommunityRating(this.plugin, this.title.id, rerenderCommunity);
	}

	/** Appends the trailer control (its own container) to the rating row. */
	private renderTrailerControl(parent: HTMLElement): void {
		const container = parent.createSpan({ cls: 'wl-trailer-control' });
		this.paintTrailerControl(container);
	}

	/**
	 * Paints the trailer control: a trailer → clickable YouTube icon (opens externally); none ('' or
	 * 'none') → a refresh button that re-fetches from source. Re-read from the store so an override
	 * saved in the edit modal shows.
	 */
	private paintTrailerControl(container: HTMLElement): void {
		container.empty();
		const title = this.dataManager.getTitle(this.title.id) ?? this.title;
		const url = getDisplayTrailer(title);
		if (url) {
			const btn = container.createEl('button', {
				cls: 'wl-trailer-btn',
				attr: { type: 'button', title: t('detail.trailer.watch'), 'aria-label': t('detail.trailer.watch') },
			});
			// mobile has room for a labelled button and needs the bigger tap target
			if (this.mobile) {
				btn.addClass('wl-trailer-btn-labeled');
				setIcon(btn, 'play');
				btn.createSpan({ cls: 'wl-trailer-btn-label', text: t('detail.trailer.label') });
			} else {
				setIcon(btn, 'youtube');
			}
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				window.open(url, '_blank');
			});
			return;
		}
		const refreshBtn = container.createEl('button', {
			cls: 'wl-community-refresh wl-trailer-refresh',
			attr: { type: 'button', title: t('detail.trailer.fetch'), 'aria-label': t('detail.trailer.fetch') },
		});
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.refreshTrailer(refreshBtn, container);
		});
	}

	/**
	 * Re-fetches the trailer from the title's source (the add-time path). A hit stores the URL and
	 * repaints; a miss marks it 'none', notifies, and keeps the refresh button.
	 */
	private async refreshTrailer(btn: HTMLElement, container: HTMLElement): Promise<void> {
		const title = this.dataManager.getTitle(this.title.id);
		if (!title) return;
		btn.addClass('is-loading');
		try {
			const animeSource = this.plugin.settings.animeApiSource ?? 'jikan';
			const group = getApiGroupForType(title.type, this.plugin.settings.typeApiMapping);
			const url = await this.plugin.apiService.fetchTrailer(title, animeSource, group);
			const hit = !!url && url !== 'none';
			this.dataManager.updateTrailerUrl(title.id, hit ? url : 'none');
			if (hit) {
				this.paintTrailerControl(container);
			} else {
				new Notice(t('detail.trailer.notFound'));
				btn.removeClass('is-loading');
			}
		} catch {
			new Notice(t('detail.trailer.notFound'));
			btn.removeClass('is-loading');
		}
	}

	private renderStars(): void {
		if (!this.starsWrapEl) return;
		renderStarRating(this.starsWrapEl, this.title.rating, {
			allowHalf: this.plugin.settings.halfStarRatings ?? false,
			tiers: this.plugin.settings.ratingSystem,
			showLabel: true,
			onChange: (value) => {
				void (async () => {
					const t = this.dataManager.getTitle(this.title.id);
					if (!t) return;
					t.rating = value;
					await this.dataManager.updateTitle(t);
					this.refreshTitle();
					this.markChanged();
					this.renderStars();
				})();
			},
		});
	}

	// Notes
	private renderNotesSection(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: 'wl-detail-notes' });
		wrap.createSpan({ cls: 'wl-stars-label', text: t('detail.notes') });
		const textarea = wrap.createEl('textarea', {
			cls: 'wl-detail-notes-input',
			attr: { placeholder: t('detail.addNotes'), rows: '3' },
		});
		textarea.value = this.title.notes;
		const autoResize = (): void => {
			// reset to intrinsic height so scrollHeight reflects the content
			textarea.style.removeProperty('height');
			textarea.setCssProps({ height: `${textarea.scrollHeight}px` });
		};
		textarea.addEventListener('input', () => {
			this.notesEditedByUser = true;
			autoResize();
		});
		window.setTimeout(autoResize, 0);

		// pull the on-disk `## Notes` body in, so edits made directly in the .md show here. Skipped once
		// the user starts typing.
		void this.dataManager.readNotesFromFile(this.title).then((fileNotes) => {
			if (fileNotes === null || this.notesEditedByUser) return;
			if (fileNotes !== textarea.value) {
				textarea.value = fileNotes;
				autoResize();
			}
			// align the in-memory model so an unchanged field isn't re-saved on blur
			this.title.notes = fileNotes;
		});

		textarea.addEventListener('blur', () => {
			if (textarea.value === this.title.notes) return;
			void (async () => {
				const t = this.dataManager.getTitle(this.title.id);
				if (!t) return;
				t.notes = textarea.value;
				await this.dataManager.updateTitle(t);
				this.refreshTitle();
				this.markChanged();
			})();
		});
	}

	// Dates (started / watched / release). Started + watched share the first row, reading
	// chronologically; release date sits on its own row below.
	private renderDateSection(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: 'wl-detail-date' });
		const topRow = wrap.createDiv({ cls: 'wl-detail-date-row' });
		this.renderDateField(topRow, t('list.footer.dateStarted'), 'dateStarted');
		const watched = this.renderDateField(topRow, t('list.footer.dateWatched'), 'dateFinished');
		// kept so a Mark-as-Watched press can restamp the field in place
		this.datePickerEl = watched.picker;
		this.refreshDateDimmed = watched.refreshDimmed;

		const bottomRow = wrap.createDiv({ cls: 'wl-detail-date-row' });
		this.renderReleaseDateField(bottomRow);
	}

	/**
	 * Release date. Apart from the two fields above because it drives the auto "To be released" status
	 * and the Upcoming entry — DataManager reconciles both once the value is persisted, so the status
	 * pill is repainted afterwards.
	 */
	private renderReleaseDateField(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: 'wl-date-field' });
		wrap.createSpan({ cls: 'wl-stars-label', text: t('list.footer.releaseDate') });
		const picker = createDatePicker({
			parent: wrap,
			inputCls: 'wl-footer-date wl-date-input',
			value: this.title.releaseDate,
			lenient: true,
			onChange: (iso) => {
				void (async () => {
					const t = this.dataManager.getTitle(this.title.id);
					if (!t) return;
					t.releaseDate = iso;
					await this.dataManager.updateTitle(t);
					await this.dataManager.applyReleaseDateChange(t);
					this.refreshTitle();
					this.markChanged();
					// applyReleaseDateChange may normalize the stored value
					picker.setValue(this.title.releaseDate, true);
					// a future date may have flipped the status to "To be released"
					this.renderStatusBadgeInPlace();
				})();
			},
		});
	}

	/** Label + "Today" shortcut + calendar date input, bound to one date field. */
	private renderDateField(
		parent: HTMLElement,
		label: string,
		field: 'dateStarted' | 'dateFinished',
	): { picker: DatePickerHandle; refreshDimmed: () => void } {
		const wrap = parent.createDiv({ cls: 'wl-date-field' });
		wrap.createSpan({ cls: 'wl-stars-label', text: label });
		const todayBtn = wrap.createEl('button', {
			cls: 'wl-btn wl-btn-sm wl-footer-today-btn',
			text: t('list.footer.today'),
		});
		const picker = createDatePicker({
			parent: wrap,
			inputCls: 'wl-footer-date wl-date-input',
			value: this.title[field],
			onChange: (iso) => {
				void (async () => {
					const t = this.dataManager.getTitle(this.title.id);
					if (!t) return;
					t[field] = iso;
					await this.dataManager.updateTitle(t);
					this.refreshTitle();
					this.markChanged();
					refreshDimmed();
				})();
			},
		});
		const refreshDimmed = (): void => {
			todayBtn.toggleClass('is-dimmed', !!picker.getValue());
		};
		refreshDimmed();
		todayBtn.addEventListener('click', () => {
			if (picker.getValue()) return;
			picker.setValue(todayIso());
			refreshDimmed();
		});
		return { picker, refreshDimmed };
	}

	// Status
	private statusColor(name: string): string {
		const def = this.getTagDef(name, this.plugin.settings.statuses);
		return def
			? getThemedColor(name, def.color, this.plugin.settings.colorTheme)
			: '#888780';
	}

	private renderStatusBadge(wrap: HTMLElement): void {
		renderTagPill({
			wrap,
			value: this.title.status,
			valueLabel: statusLabel(this.title.status),
			color: this.statusColor(this.title.status),
			tooltip: t('detail.clickToChangeStatus'),
			container: this.contentEl,
			options: this.plugin.settings.statuses
				.filter((s) => s.name !== 'To be released')
				.map((s) => ({ value: s.name, label: statusLabel(s.name) })),
			getOptionColor: (name) => this.statusColor(name),
			onSelect: (name) => void this.saveStatus(name).then(() => this.renderStatusBadge(wrap)),
		});
	}

	private async saveStatus(status: string): Promise<void> {
		const t = this.dataManager.getTitle(this.title.id);
		if (!t) return;
		t.status = status;
		await this.dataManager.updateTitle(t);
		this.refreshTitle();
		this.markChanged();
	}

	// Priority
	private priorityColor(name: string): string {
		const def = this.getTagDef(name, this.plugin.settings.priorities);
		return def
			? getThemedColor(name, def.color, this.plugin.settings.colorTheme)
			: '#888780';
	}

	private renderPriorityBadge(wrap: HTMLElement): void {
		const priority = this.title.priority;
		renderTagPill({
			wrap,
			value: priority,
			emptyLabel: t('list.footer.noPriority'),
			color: priority ? this.priorityColor(priority) : null,
			tooltip: t('detail.clickToChangePriority'),
			container: this.contentEl,
			options: [
				...this.plugin.settings.priorities.map((p) => p.name),
				{ value: '', label: t('list.footer.noPriority') },
			],
			getOptionColor: (name) => (name ? this.priorityColor(name) : null),
			onSelect: (name) => void this.savePriority(name).then(() => this.renderPriorityBadge(wrap)),
		});
	}

	private async savePriority(priority: string): Promise<void> {
		const t = this.dataManager.getTitle(this.title.id);
		if (!t) return;
		t.priority = priority;
		await this.dataManager.updateTitle(t);
		this.refreshTitle();
		this.markChanged();
	}

	// Footer
	private renderFooter(parent: HTMLElement): void {
		const footer = parent.createDiv({ cls: 'wl-detail-footer wl-detail-footer-centered' });
		this.footerEl = footer;
		const removeBtn = footer.createEl('button', {
			cls: 'wl-delete-btn wl-btn-danger wl-detail-remove',
			text: t('common.remove'),
		});
		removeBtn.addEventListener('click', () => {
			new ConfirmModal(
				this.plugin.app,
				t('list.removeTitleConfirm', { title: this.title.title }),
				() => {
					void this.dataManager.removeTitle(this.title.id).then(() => {
						this.markChanged();
						this.close();
					});
				},
			).open();
		});

		// favorite heart, centered by the footer's space-between. Updates in place, no re-render.
		const favBtn = footer.createEl('button', {
			cls: 'wl-detail-fav-btn',
			attr: { type: 'button' },
		});
		setIcon(favBtn, 'heart');
		const paintFav = (): void => {
			const fav = !!this.title.favorite;
			paintFavoriteButton(favBtn, fav);
		};
		paintFav();
		favBtn.addEventListener('click', () => {
			void this.dataManager.setFavorite(this.title.id, !this.title.favorite);
			this.refreshTitle();
			this.markChanged();
			paintFav();
		});

		// grouped with Edit so the footer keeps three children and the heart stays centered
		const right = footer.createDiv({ cls: 'wl-detail-footer-right' });
		const collectionHost = right.createDiv({ cls: 'wl-detail-collection-host' });
		void this.maybeRenderCollectionButton(collectionHost);

		const editBtn = right.createEl('button', {
			cls: 'wl-edit-btn wl-detail-edit',
			text: t('common.edit'),
		});
		editBtn.addEventListener('click', () => {
			const current = this.dataManager.getTitle(this.title.id);
			if (!current) return;
			this.close();
			new EditTitleModal(this.plugin.app, this.plugin, this.dataManager, current, () => {
				if (this.onChanged) this.onChanged();
			}).open();
		});
	}

	// silent on every failure — no key, no match, network error: no button
	private async maybeRenderCollectionButton(host: HTMLElement): Promise<void> {
		let collection: TmdbCollectionDetail | null = null;
		try {
			collection = await resolveCollection(this.plugin, this.title);
		} catch {
			return;
		}
		// modal may have closed mid-flight
		if (!collection || !host.isConnected) return;
		// 1-film collection is a TMDB artifact
		if ((collection.parts ?? []).length < 2) return;
		this.paintCollectionButton(host, collection);
	}

	private paintCollectionButton(host: HTMLElement, collection: TmdbCollectionDetail): void {
		host.empty();
		const missing = countMissing(collection, this.dataManager.getTitles());

		const btn = host.createEl('button', {
			cls: 'wl-collection-btn',
			attr: { type: 'button' },
		});
		setIcon(btn, 'layers');
		btn.createSpan({
			cls: 'wl-collection-btn-label',
			text: missing > 0 ? t('detail.collection.missing', { count: missing }) : t('detail.collection.label'),
		});
		if (missing > 0) btn.addClass('has-missing');
		// mobile has no room for Remove · centred heart · Collection + Edit — park the heart
		// beside Remove instead. Only when this button exists; otherwise it stays centred.
		if (Platform.isMobile) {
			host.closest<HTMLElement>('.wl-detail-footer')?.addClass('wl-footer-heart-left');
		}
		const label = missing > 0
			? t('detail.collection.tipMissing', { name: collection.name, count: missing })
			: t('detail.collection.tipComplete', { name: collection.name });
		btn.title = label;
		btn.setAttr('aria-label', label);

		btn.addEventListener('click', () => {
			new CollectionModal(
				this.plugin.app,
				this.plugin,
				collection,
				this.title.type,
				(title) => {
					this.close();
					new TitleDetailModal(
						this.plugin.app,
						this.plugin,
						title,
						() => {
							if (this.onChanged) this.onChanged();
						},
						this.onPersonClick,
					).open();
				},
				() => {
					this.markChanged();
					// this modal stays open behind — keep the count honest
					if (host.isConnected) this.paintCollectionButton(host, collection);
				},
			).open();
		});
	}
}

// Credits refresh button (shared). In-flight refreshes keyed by title id, shared with the List
// view's expanded row so a mid-flight re-render keeps the icon spinning and the two entry points
// can't double-fetch.
const creditsRefreshInFlight = new Set<string>();

/**
 * Small ⟳ above the Director row: forces a re-fetch regardless of state — including fields already
 * holding data or the 'none' sentinel, which the automatic backfill never retries. Overwrites both
 * fields (a failed fetch still ends at 'none'). `onDone` fires when the attempt settles, with
 * `changed` true only if it persisted.
 */
export function renderCreditsRefreshButton(
	parent: HTMLElement,
	plugin: WatchLogPlugin,
	title: WatchLogTitle,
	onDone: (changed: boolean) => void,
): void {
	const btn = parent.createEl('button', { cls: 'wl-credits-refresh', text: '⟳' });
	btn.title = t('detail.credits.refresh');
	btn.setAttr('aria-label', t('detail.credits.refresh'));
	if (creditsRefreshInFlight.has(title.id)) btn.addClass('is-loading');
	btn.addEventListener('click', () => {
		if (creditsRefreshInFlight.has(title.id)) return;
		creditsRefreshInFlight.add(title.id);
		btn.addClass('is-loading');
		void (async () => {
			let changed = false;
			try {
				const t = plugin.dataManager.getTitle(title.id) ?? title;
				const fetched = await plugin.apiService.fetchCredits(
					t,
					plugin.settings.activeApi ?? 'OMDb',
				);
				await plugin.dataManager.updateCredits(
					t.id,
					fetched?.director ?? [CREDITS_NONE],
					fetched?.cast ?? [CREDITS_NONE],
				);
				changed = true;
			} catch {
				// persistence failed — stored fields stay as they were
			} finally {
				creditsRefreshInFlight.delete(title.id);
				// stop the spin here — callers that re-render the button would clear it, but the
				// mobile badge-row copy outlives renderCreditsSection
				btn.removeClass('is-loading');
			}
			onDone(changed);
		})();
	});
}

// Credits rows (shared)

/** Handlers the credits rows accept; each is optional and gates its own control. */
interface CreditsRowHandlers {
	/** Enables the name → person-filter click. */
	onPersonClick?: (name: string) => void;
	/** Enables the leading `+`, which opens the add modal for that field. */
	onAddCredits?: (field: CreditsField) => void;
	/** Enables the ✕ on user-added names. */
	onRemoveManual?: (field: CreditsField, name: string) => void;
	/** Mobile detail modal: studio joins Director / Cast as a labelled row instead of title chips. */
	includeStudio?: boolean;
}

/**
 * Renders the Director / Cast rows used by both the detail modal and the List view's expanded row,
 * over the merged view (fetched names, then user-added).
 *
 * A field with nothing fetched, nothing added and no way to add renders nothing — but an add
 * handler makes the row always appear, which is what gives anime titles (no IMDb id, so credits
 * never fetch) a place to put a cast. The 'none' sentinel renders an em-dash.
 *
 * Past CREDITS_INLINE_LIMIT the remainder collapses behind a "+N more" chip that expands in place —
 * a popover would be clipped by the accordion.
 */
export function renderCreditsRows(
	parent: HTMLElement,
	title: WatchLogTitle,
	handlers: CreditsRowHandlers = {},
): void {
	const { onPersonClick, onAddCredits, onRemoveManual, includeStudio } = handlers;

	// label and values each get their own wrapper so the mobile modal can lay the row out as a
	// two-column grid; inline on desktop, so the flat rendering is unchanged
	const renderRow = (label: string, field: CreditsField): void => {
		const values = getTitleCredits(title, field);
		const fetched =
			field === 'director' ? title.director : field === 'cast' ? title.cast : title.studio;
		if (values.length === 0 && isCreditsUnfetched(fetched) && !onAddCredits) return;

		const row = parent.createDiv({ cls: 'wl-credits-row' });
		const labelEl = row.createSpan({ cls: 'wl-credits-label' });

		// studio has no add path — AddCreditModal's pool and labels are director/cast only
		if (onAddCredits && field !== 'studio') {
			const addBtn = labelEl.createEl('button', { cls: 'wl-credits-add', text: '+' });
			const addLabel = t(field === 'director' ? 'detail.credits.addDirector' : 'detail.credits.addCast');
			addBtn.title = addLabel;
			addBtn.setAttr('aria-label', addLabel);
			addBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				onAddCredits(field);
			});
		}
		labelEl.createSpan({ cls: 'wl-credits-label-text', text: label });

		const valuesEl = row.createSpan({ cls: 'wl-credits-values' });

		if (values.length === 0) {
			valuesEl.createSpan({ cls: 'wl-credits-empty', text: '—' });
			return;
		}

		const manualKeys = new Set(getManualCredits(title, field).map((n) => n.toLowerCase()));
		const renderName = (container: HTMLElement, name: string): HTMLElement => {
			const isManual = manualKeys.has(name.toLowerCase());
			const el = container.createSpan({ cls: 'wl-credits-name' });
			if (isManual) el.addClass('is-manual');
			const text = el.createSpan({ cls: 'wl-credits-name-text', text: name });
			if (onPersonClick) {
				text.addClass('is-clickable');
				text.title = t('detail.credits.showTitlesWith', { name });
				text.addEventListener('click', (e) => {
					e.stopPropagation();
					onPersonClick(name);
				});
			}
			if (isManual && onRemoveManual) {
				const del = el.createEl('button', { cls: 'wl-credits-name-del', text: '✕' });
				const removeLabel = t('detail.credits.removeName', { name });
				del.title = removeLabel;
				del.setAttr('aria-label', removeLabel);
				del.addEventListener('click', (e) => {
					e.stopPropagation();
					onRemoveManual(field, name);
				});
			}
			return el;
		};

		const inline = values.slice(0, CREDITS_INLINE_LIMIT);
		const overflow = values.slice(CREDITS_INLINE_LIMIT);
		inline.forEach((name, i) => {
			if (i > 0) valuesEl.createSpan({ cls: 'wl-credits-sep', text: ', ' });
			renderName(valuesEl, name);
		});

		if (overflow.length === 0) return;
		const moreBtn = valuesEl.createEl('button', {
			cls: 'wl-credits-more',
			text: t('detail.more', { count: overflow.length }),
		});
		const overflowEl = parent.createDiv({ cls: 'wl-credits-overflow' });
		overflowEl.hide();
		for (const name of overflow) renderName(overflowEl, name).addClass('wl-credits-chip');
		moreBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const expanded = !overflowEl.isShown();
			overflowEl.toggle(expanded);
			moreBtn.setText(expanded ? t('detail.showLess') : t('detail.more', { count: overflow.length }));
		});
	};

	if (includeStudio) {
		const studios = getTitleCredits(title, 'studio');
		renderRow(t('detail.studio', { count: studios.length }), 'studio');
	}
	renderRow(t('list.searchField.director'), 'director');
	renderRow(t('list.searchField.cast'), 'cast');
}

// Group detail modal
export class GroupDetailModal extends Modal {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private group: WatchLogGroup;
	private members: WatchLogTitle[];
	private onChanged?: () => void;
	private onPersonClick?: (name: string) => void;
	private changed = false;

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		group: WatchLogGroup,
		members: WatchLogTitle[],
		onChanged?: () => void,
		onPersonClick?: (name: string) => void,
	) {
		super(app);
		this.plugin = plugin;
		this.dataManager = plugin.dataManager;
		this.group = group;
		this.members = members;
		this.onChanged = onChanged;
		this.onPersonClick = onPersonClick;
	}

	onOpen(): void {
		const colorTheme = this.plugin.settings.colorTheme ?? 'default';
		this.modalEl.setAttribute('data-theme', colorTheme);
		this.contentEl.setAttribute('data-theme', colorTheme);
		this.contentEl.addClass('wl-view');
		this.contentEl.addClass('wl-detail-modal');
		this.renderAll();
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.changed && this.onChanged) this.onChanged();
	}

	private renderAll(): void {
		this.contentEl.empty();
		const totalEps = this.members.reduce(
			(s, m) => s + this.dataManager.getEffectiveTotal(m),
			0,
		);
		const watchedEps = this.members.reduce((s, m) => s + m.watchedEpisodes.length, 0);
		const progress = totalEps > 0 ? Math.round((watchedEps / totalEps) * 100) : 0;
		renderGroupDetailHeader(this.contentEl, {
			name: this.group.name,
			countText: t('ui.group.countTitle', { count: this.members.length }),
			progress,
		});

		const grid = this.contentEl.createDiv({ cls: 'wl-cards-grid wl-detail-group-grid' });
		for (const m of this.members) {
			const card = buildTitleCardElement(this.plugin, m, {
				onOpenDetail: () => {
					this.close();
					new TitleDetailModal(this.plugin.app, this.plugin, m, () => {
						this.changed = true;
						if (this.onChanged) this.onChanged();
					}, this.onPersonClick).open();
				},
				onEdit: () => {
					this.close();
					new EditTitleModal(
						this.plugin.app,
						this.plugin,
						this.dataManager,
						m,
						() => {
							this.changed = true;
							if (this.onChanged) this.onChanged();
						},
					).open();
				},
			});
			grid.appendChild(card);
		}
	}
}

// Standalone .wl-card matching the Cards grid look. Used by ListTab and by GroupDetailModal so
// member tiles look identical. Posters with no cached URL are fetched eagerly here — a group modal
// has a small, finite member count.
function buildTitleCardElement(
	plugin: WatchLogPlugin,
	title: WatchLogTitle,
	handlers: { onOpenDetail: () => void; onEdit: () => void },
): HTMLElement {
	const settings = plugin.settings;
	const typeDef = settings.types.find((d) => d.name === title.type);
	const statusDef = settings.statuses.find((d) => d.name === title.status);
	const typeColor = typeDef
		? getThemedColor(title.type, typeDef.color, settings.colorTheme)
		: '#888780';

	const tmp = createDiv();
	const card = tmp.createDiv({ cls: 'wl-card' });
	card.dataset.titleId = title.id;

	const placeholder = card.createDiv({ cls: 'wl-card-poster-placeholder' });
	placeholder.style.backgroundColor = typeColor;
	const letter = (title.title.trim().charAt(0) || '?').toUpperCase();
	placeholder.createSpan({ text: letter });

	const img = card.createEl('img', { cls: 'wl-card-poster' });
	img.alt = title.title;

	const showImg = (url: string): void => {
		img.src = url;
		card.addClass('has-poster');
	};
	const showPlaceholder = (): void => {
		card.removeClass('has-poster');
	};

	const display = getDisplayPoster(title);
	if (display && display.startsWith('http')) {
		showImg(display);
		img.onerror = () => {
			showPlaceholder();
			void plugin.dataManager.updatePosterUrl(title.id, 'none');
		};
	} else if (title.posterUrl === '') {
		placeholder.addClass('is-loading');
		void plugin.posterService?.enqueue(title).then((url) => {
			placeholder.removeClass('is-loading');
			if (url) showImg(url);
		});
	}

	if (statusDef) {
		const statusBadge = card.createSpan({
			cls: 'wl-card-status-badge',
			text: statusLabel(title.status),
		});
		statusBadge.style.backgroundColor = getThemedColor(
			title.status,
			statusDef.color,
			settings.colorTheme,
		);
	}

	const overlay = card.createDiv({ cls: 'wl-card-overlay' });
	overlay.createSpan({ cls: 'wl-card-title', text: title.title });
	const metaRow = overlay.createDiv({ cls: 'wl-card-meta-row' });
	const typeBadge = metaRow.createSpan({ cls: 'wl-card-type-badge', text: typeLabel(title.type) });
	typeBadge.style.backgroundColor = typeColor;
	// release year beside the type badge; omitted when unknown (matches ListTab's card)
	const yearMatch = title.releaseDate?.match(/^(\d{4})/);
	if (yearMatch) metaRow.createSpan({ cls: 'wl-card-year', text: yearMatch[1] });

	const total = title.totalEpisodes;
	if (total && total > 0) {
		const isCompleted = title.status === 'Completed';
		const ratio = isCompleted
			? 1
			: Math.max(0, Math.min(1, title.watchedEpisodes.length / total));
		const bar = overlay.createDiv({ cls: 'wl-card-progress-bar' });
		const fill = bar.createDiv({ cls: 'wl-card-progress-fill' });
		fill.style.width = `${ratio * 100}%`;
	}

	const menuBtn = card.createEl('button', { cls: 'wl-card-menu-btn', text: '⋮' });
	menuBtn.setAttr('aria-label', t('common.edit'));
	menuBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		handlers.onEdit();
	});

	card.addEventListener('click', () => handlers.onOpenDetail());

	return card;
}

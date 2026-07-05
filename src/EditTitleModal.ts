import { App, Modal, Notice } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { WatchLogTitle, WatchLogGroup, Season } from './types';
import { formatDateDisplay, parseDateInput, parseReleaseDateInput } from './types';

/** Parses "5,8,33-37,42" into a sorted unique flat array of numbers. */
function parseSkipSpec(spec: string): number[] {
	const result: number[] = [];
	for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
		const rangeParts = part.split('-');
		if (rangeParts.length === 2) {
			const from = parseInt(rangeParts[0] ?? '0', 10);
			const to = parseInt(rangeParts[1] ?? '0', 10);
			if (!isNaN(from) && !isNaN(to) && from <= to) {
				for (let i = from; i <= to; i++) result.push(i);
			}
		} else {
			const n = parseInt(part, 10);
			if (!isNaN(n)) result.push(n);
		}
	}
	return [...new Set(result)].sort((a, b) => a - b);
}

/** Serializes a sorted number array into a compact skip-spec string like "5,8,33-37,42". */
function serializeSkipSpec(nums: number[]): string {
	if (nums.length === 0) return '';
	const sorted = [...new Set(nums)].sort((a, b) => a - b);
	const parts: string[] = [];
	let i = 0;
	while (i < sorted.length) {
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] as number) + 1) j++;
		if (j > i) {
			parts.push(`${sorted[i]}-${sorted[j]}`);
		} else {
			parts.push(String(sorted[i]));
		}
		i = j + 1;
	}
	return parts.join(',');
}

/** Parses a seasons textarea (one line per season: "Name: N" or "Name: N (skip_spec)") back to Season[]. */
function parseSeasonsText(text: string): Season[] {
	const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
	const seasons: Season[] = [];
	let offset = 0;
	for (const line of lines) {
		// Match "Name: N" optionally followed by " (skip_spec)"
		const match = line.match(/^(.+?):\s*(\d+)(?:\s*\(([^)]+)\))?/);
		if (match && match[1] && match[2]) {
			const eps = parseInt(match[2], 10);
			const skippedEpisodes = match[3] ? parseSkipSpec(match[3]) : [];
			seasons.push({ name: match[1].trim(), episodes: eps, offset, skippedEpisodes });
			offset += eps;
		}
	}
	return seasons;
}

function seasonsToText(seasons: Season[]): string {
	return seasons.map((s) => {
		const base = `${s.name}: ${s.episodes}`;
		if (s.skippedEpisodes && s.skippedEpisodes.length > 0) {
			return `${base} (${serializeSkipSpec(s.skippedEpisodes)})`;
		}
		return base;
	}).join('\n');
}

export class EditTitleModal extends Modal {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private original: WatchLogTitle;
	private onSaved: () => void;

	// Editable state (mirrors all WatchLogTitle fields)
	private fieldTitle: string;
	private fieldType: string;
	private fieldEpisodes: number;
	private fieldDuration: number;
	private fieldReleaseDate: string;
	private fieldLink: string;
	private fieldSeasonsText: string;
	private fieldStatus: string;
	private fieldPriority: string;
	private fieldReview: string;
	private fieldRating: number;
	private fieldNotes: string;
	private fieldDateStarted: string;
	private fieldDateFinished: string;
	private fieldPosterUrl: string;
	private fieldTrailerUrl: string;
	// Group assignment (mirrors AddTitleModal). `originalGroupId` records the group
	// the title belonged to on open, so save can move/detach it only when changed.
	private originalGroupId = '';
	private selectedGroupId = '';
	private newGroupName = '';
	private skipDuplicateCheck = false;
	private duplicateWarningEl: HTMLElement | null = null;
	private notesInput: HTMLTextAreaElement | null = null;
	private notesEditedByUser = false;

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		dataManager: DataManager,
		title: WatchLogTitle,
		onSaved: () => void,
	) {
		super(app);
		this.plugin = plugin;
		this.dataManager = dataManager;
		this.original = title;
		this.onSaved = onSaved;

		// Pre-populate from existing title
		this.fieldTitle = title.title;
		this.fieldType = title.type;
		this.fieldEpisodes = title.totalEpisodes;
		this.fieldDuration = title.episodeDuration;
		this.fieldReleaseDate = title.releaseDate ?? '';
		this.fieldLink = title.externalLink;
		this.fieldSeasonsText = seasonsToText(title.seasons);
		this.fieldStatus = title.status;
		this.fieldPriority = title.priority;
		this.fieldReview = title.review ?? '';
		this.fieldRating = title.rating;
		this.fieldNotes = title.notes;
		this.fieldDateStarted = title.dateStarted ?? '';
		this.fieldDateFinished = title.dateFinished ?? '';
		this.fieldPosterUrl = title.manualPosterUrl ?? '';
		this.fieldTrailerUrl = title.manualTrailerUrl ?? '';
		// Seed the group dropdown with the title's current group (if any).
		this.originalGroupId =
			this.dataManager.getGroups().find((g) => g.titleIds.includes(title.id))?.id ?? '';
		this.selectedGroupId = this.originalGroupId;
	}

	onOpen(): void {
		this.titleEl.setText(`Edit: ${this.original.title}`);
		this.contentEl.addClass('wl-add-modal');
		this.buildUI();
		// Pull the ## Notes body back from the .md file so manual edits made directly
		// in the file are reflected in the modal (mirrors Reading reading Quotes back).
		void this.syncNotesFromFile();
	}

	/** Reflects the on-disk ## Notes body into the notes field, unless the user is already editing it. */
	private async syncNotesFromFile(): Promise<void> {
		const fileNotes = await this.dataManager.readNotesFromFile(this.original);
		if (fileNotes === null || this.notesEditedByUser) return;
		this.fieldNotes = fileNotes;
		if (this.notesInput) this.notesInput.value = fileNotes;
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private buildUI(): void {
		const content = this.contentEl;
		content.empty();

		const makeRow = (label: string): HTMLElement => {
			const row = content.createDiv({ cls: 'wl-modal-row' });
			row.createSpan({ cls: 'wl-modal-label', text: label });
			return row;
		};

		// A paired-row cell: [label][fixed-width input]. Mirrors AddTitleModal so two
		// labelled fields share one row (left cell aligns with full-width inputs, the
		// right cell anchors to the row's right edge). See .wl-modal-pair-cell CSS.
		const makeCell = (row: HTMLElement, label: string, right = false): HTMLElement => {
			const cell = row.createDiv({
				cls: right ? 'wl-modal-pair-cell wl-modal-pair-cell-right' : 'wl-modal-pair-cell',
			});
			cell.createSpan({ cls: 'wl-modal-label', text: label });
			return cell;
		};

		// Title
		const titleRow = makeRow('Title');
		const titleInput = titleRow.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'text' },
		});
		titleInput.value = this.fieldTitle;
		titleInput.addEventListener('input', () => { this.fieldTitle = titleInput.value; });

		// Type
		const typeRow = makeRow('Type');
		const typeSelect = typeRow.createEl('select', { cls: 'wl-select' });
		for (const t of this.plugin.settings.types) {
			const opt = typeSelect.createEl('option', { text: t.name, value: t.name });
			if (t.name === this.fieldType) opt.selected = true;
		}
		typeSelect.addEventListener('change', () => { this.fieldType = typeSelect.value; });

		// Status + Priority paired 50/50 on one row.
		// ("To be released" is auto-assigned; show it only if the title currently has it.)
		const statusPriRow = content.createDiv({ cls: 'wl-modal-row wl-modal-row-pair' });
		const statusCell = makeCell(statusPriRow, 'Status');
		const statusSelect = statusCell.createEl('select', { cls: 'wl-select' });
		const showToBeReleased = this.fieldStatus === 'To be released';
		for (const s of this.plugin.settings.statuses) {
			if (s.name === 'To be released' && !showToBeReleased) continue;
			const opt = statusSelect.createEl('option', { text: s.name, value: s.name });
			if (s.name === this.fieldStatus) opt.selected = true;
		}
		statusSelect.addEventListener('change', () => { this.fieldStatus = statusSelect.value; });

		const priCell = makeCell(statusPriRow, 'Priority', true);
		const priSelect = priCell.createEl('select', { cls: 'wl-select' });
		for (const p of this.plugin.settings.priorities) {
			const opt = priSelect.createEl('option', { text: p.name, value: p.name });
			if (p.name === this.fieldPriority) opt.selected = true;
		}
		priSelect.addEventListener('change', () => { this.fieldPriority = priSelect.value; });

		// Rating
		const ratingRow = makeRow('Rating');
		const starsWrap = ratingRow.createDiv({ cls: 'wl-stars' });
		const updateStarDisplay = (): void => {
			starsWrap.empty();
			for (let i = 1; i <= 5; i++) {
				const star = starsWrap.createSpan({
					cls: `wl-star${this.fieldRating >= i ? ' is-active' : ''}`,
					text: '★',
				});
				star.addEventListener('click', () => {
					this.fieldRating = this.fieldRating === i ? 0 : i;
					updateStarDisplay();
				});
			}
		};
		updateStarDisplay();

		// Total episodes + Ep. duration paired on one row (episodes keeps its seasons
		// skip/watch inline labels and behaviour untouched — only the layout changed).
		const epsDurRow = content.createDiv({ cls: 'wl-modal-row wl-modal-row-pair' });
		const epsCell = makeCell(epsDurRow, 'Total episodes');
		const epsInput = epsCell.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'number', min: '0' },
		});
		epsInput.value = String(this.fieldEpisodes);
		const epsSkipLabel = epsCell.createSpan({ cls: 'wl-modal-skip-inline' });
		const epsWatchLabel = epsCell.createSpan({ cls: 'wl-modal-skip-inline' });

		const updateSkipCounts = (): void => {
			const parsed = parseSeasonsText(this.fieldSeasonsText);
			const totalSkipped = parsed.reduce((sum, s) => sum + (s.skippedEpisodes?.length ?? 0), 0);
			if (totalSkipped === 0) {
				epsSkipLabel.textContent = '';
				epsWatchLabel.textContent = '';
				return;
			}
			const toWatch = Math.max(0, this.fieldEpisodes - totalSkipped);
			epsSkipLabel.textContent = `· ${totalSkipped} to skip`;
			epsWatchLabel.textContent = `· ${toWatch} to watch`;
		};

		epsInput.addEventListener('input', () => {
			this.fieldEpisodes = parseInt(epsInput.value) || 0;
			updateSkipCounts();
		});

		const durCell = makeCell(epsDurRow, 'Ep. duration (min)', true);
		const durInput = durCell.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'number', min: '0' },
		});
		durInput.value = String(this.fieldDuration);
		durInput.addEventListener('input', () => { this.fieldDuration = parseInt(durInput.value) || 0; });

		// Release date
		const relRow = makeRow('Release date');
		const relStack = relRow.createDiv({ cls: 'wl-modal-input-stack' });
		const relInput = relStack.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'text', placeholder: 'Date (dd-mm-yyyy or yyyy-mm-dd)' },
		});
		relInput.value = this.fieldReleaseDate;
		const relErrorEl = relStack.createDiv({ cls: 'wl-modal-error wl-hidden' });
		relInput.addEventListener('change', () => {
			const raw = relInput.value.trim();
			if (!raw) {
				this.fieldReleaseDate = '';
				relErrorEl.addClass('wl-hidden');
				return;
			}
			const parsed = parseReleaseDateInput(raw);
			if (parsed) {
				this.fieldReleaseDate = parsed;
				relInput.value = parsed;
				relErrorEl.addClass('wl-hidden');
			} else {
				this.fieldReleaseDate = raw;
				relErrorEl.textContent = 'Unrecognised format. Expected dd/mm/yyyy or yyyy-mm-dd.';
				relErrorEl.removeClass('wl-hidden');
			}
		});

		// External link
		const linkRow = makeRow('External link');
		const linkInput = linkRow.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'url', placeholder: 'HTTPS://...' },
		});
		linkInput.value = this.fieldLink;
		linkInput.addEventListener('input', () => { this.fieldLink = linkInput.value; });

		// Poster URL (manual override) — directly under External link
		const posterRow = makeRow('Poster URL');
		const posterStack = posterRow.createDiv({ cls: 'wl-modal-input-stack' });
		const posterInput = posterStack.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'url', placeholder: 'https://example.com/poster.jpg' },
		});
		posterInput.value = this.fieldPosterUrl;
		posterInput.addEventListener('input', () => { this.fieldPosterUrl = posterInput.value; });
		posterStack.createDiv({
			cls: 'wl-modal-info',
			text: 'Override the auto-fetched cover. Leave blank to let WatchLog fetch one again.',
		});

		// Trailer URL (manual override) — directly under Poster URL
		const trailerRow = makeRow('Trailer URL');
		const trailerStack = trailerRow.createDiv({ cls: 'wl-modal-input-stack' });
		const trailerInput = trailerStack.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'url', placeholder: 'https://www.youtube.com/watch?v=...' },
		});
		trailerInput.value = this.fieldTrailerUrl;
		trailerInput.addEventListener('input', () => { this.fieldTrailerUrl = trailerInput.value; });
		trailerStack.createDiv({
			cls: 'wl-modal-info',
			text: 'Override the auto-fetched trailer. Leave blank to use the fetched one.',
		});

		// Date started + Date finished paired on one row.
		const datesRow = content.createDiv({ cls: 'wl-modal-row wl-modal-row-pair' });
		const startCell = makeCell(datesRow, 'Date started');
		const startInput = startCell.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'text', placeholder: 'Dd/mm/yyyy', maxlength: '10' },
		});
		startInput.value = formatDateDisplay(this.fieldDateStarted);
		startInput.addEventListener('change', () => {
			const parsed = parseDateInput(startInput.value);
			if (startInput.value.trim() && !parsed) {
				startInput.addClass('wl-input-error');
			} else {
				startInput.removeClass('wl-input-error');
				this.fieldDateStarted = parsed ?? '';
			}
		});

		const finCell = makeCell(datesRow, 'Date finished', true);
		const finInput = finCell.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'text', placeholder: 'Dd/mm/yyyy', maxlength: '10' },
		});
		finInput.value = formatDateDisplay(this.fieldDateFinished);
		finInput.addEventListener('change', () => {
			const parsed = parseDateInput(finInput.value);
			if (finInput.value.trim() && !parsed) {
				finInput.addClass('wl-input-error');
			} else {
				finInput.removeClass('wl-input-error');
				this.fieldDateFinished = parsed ?? '';
			}
		});

		// Group assignment (move / create) — ported from AddTitleModal, seeded with
		// the title's current group. Dropdown and new-name input disable each other.
		const groups = this.dataManager.getGroups();
		const addToGroupRow = makeRow('Add to group');
		const groupSelect = addToGroupRow.createEl('select', { cls: 'wl-select' });
		groupSelect.createEl('option', { text: '— none —', value: '' });
		for (const g of groups) {
			const opt = groupSelect.createEl('option', { text: g.name, value: g.id });
			if (g.id === this.selectedGroupId) opt.selected = true;
		}

		const newGroupRow = makeRow('Or create new group');
		const newGroupInput = newGroupRow.createEl('input', {
			cls: 'wl-modal-input',
			attr: { type: 'text', placeholder: 'New group name...' },
		});
		newGroupInput.value = this.newGroupName;

		groupSelect.addEventListener('change', () => {
			this.selectedGroupId = groupSelect.value;
			if (this.selectedGroupId) {
				this.newGroupName = '';
				newGroupInput.value = '';
				newGroupInput.disabled = true;
			} else {
				newGroupInput.disabled = false;
			}
		});

		newGroupInput.addEventListener('input', () => {
			this.newGroupName = newGroupInput.value;
			if (this.newGroupName.trim()) {
				this.selectedGroupId = '';
				groupSelect.value = '';
				groupSelect.disabled = true;
			} else {
				groupSelect.disabled = false;
			}
		});

		if (this.selectedGroupId) newGroupInput.disabled = true;
		if (this.newGroupName.trim()) groupSelect.disabled = true;

		// Notes
		const notesRow = makeRow('Notes');
		const notesInput = notesRow.createEl('textarea', {
			cls: 'wl-modal-textarea',
			attr: { rows: '3', placeholder: 'Your notes...' },
		});
		notesInput.value = this.fieldNotes;
		this.notesInput = notesInput;
		notesInput.addEventListener('input', () => {
			this.notesEditedByUser = true;
			this.fieldNotes = notesInput.value;
		});

		// Seasons
		const seasonsRow = makeRow('Seasons');
		const seasonsHelp = seasonsRow.createDiv({ cls: 'wl-modal-input-stack' });
		const seasonsInput = seasonsHelp.createEl('textarea', {
			cls: 'wl-modal-textarea',
			attr: { rows: '4', placeholder: 'Season 1: 12\nSeason 2: 13 (5,8,33-37)' },
		});
		seasonsInput.value = this.fieldSeasonsText;

		const totalPreviewEl = seasonsHelp.createDiv({ cls: 'wl-modal-season-total' });
		const updateTotalPreview = (): void => {
			const parsed = parseSeasonsText(seasonsInput.value);
			const total = parsed.reduce((sum, s) => sum + s.episodes, 0);
			const totalSkipped = parsed.reduce((sum, s) => sum + (s.skippedEpisodes?.length ?? 0), 0);
			totalPreviewEl.textContent = totalSkipped > 0
				? `Total episodes: ${total} · ${totalSkipped} to skip`
				: `Total episodes: ${total}`;
		};
		updateTotalPreview();
		updateSkipCounts();

		seasonsInput.addEventListener('input', () => {
			this.fieldSeasonsText = seasonsInput.value;
			updateTotalPreview();
			updateSkipCounts();
		});

		seasonsHelp.createDiv({
			cls: 'wl-modal-info',
			text: 'Format: "Season Name: N" (e.g. "Season 1: 12")',
		});
		seasonsHelp.createDiv({
			cls: 'wl-modal-info',
			text: 'Skip episodes: add "(1,3,5-10)" after count (e.g. "Season 1: 48 (33-37)")',
		});
		seasonsHelp.createDiv({
			cls: 'wl-modal-info',
			text: 'Note: when adding a new season, remember to update "Total Episodes" so progress calculates correctly.',
		});

		// Save / Cancel
		const btnRow = content.createDiv({ cls: 'wl-modal-btn-row' });
		const cancelBtn = btnRow.createEl('button', { cls: 'wl-btn', text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Save changes' });
		saveBtn.addEventListener('click', () => void this.saveTitle());
	}

	private showDuplicateWarning(titleName: string, btnRow: HTMLElement): void {
		if (this.duplicateWarningEl) return;
		const warn = btnRow.createDiv({ cls: 'wl-duplicate-warning' });
		this.duplicateWarningEl = warn;
		warn.createSpan({ text: `"${titleName}" already exists. Save anyway?` });
		const continueBtn = warn.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Continue' });
		const cancelBtn = warn.createEl('button', { cls: 'wl-btn', text: 'Cancel' });
		continueBtn.addEventListener('click', () => {
			this.skipDuplicateCheck = true;
			warn.remove();
			this.duplicateWarningEl = null;
			void this.saveTitle();
		});
		cancelBtn.addEventListener('click', () => {
			warn.remove();
			this.duplicateWarningEl = null;
			this.skipDuplicateCheck = false;
		});
	}

	private async saveTitle(): Promise<void> {
		const titleName = this.fieldTitle.trim();
		if (!titleName) {
			new Notice('Title name cannot be empty.');
			return;
		}

		if (!this.skipDuplicateCheck) {
			const duplicate = this.dataManager.getTitles().find(
				(t) => t.id !== this.original.id && t.title.toLowerCase() === titleName.toLowerCase()
			);
			if (duplicate) {
				const btnRow = this.contentEl.querySelector<HTMLElement>('.wl-modal-btn-row');
				if (btnRow) this.showDuplicateWarning(titleName, btnRow);
				return;
			}
		}
		this.skipDuplicateCheck = false;

		const seasons = parseSeasonsText(this.fieldSeasonsText);
		const newReleaseDate = this.fieldReleaseDate || null;

		const updated: WatchLogTitle = {
			...this.original,
			title: titleName,
			type: this.fieldType,
			status: this.fieldStatus,
			priority: this.fieldPriority,
			review: this.fieldReview,
			rating: this.fieldRating,
			notes: this.fieldNotes,
			totalEpisodes: this.fieldEpisodes,
			episodeDuration: this.fieldDuration,
			releaseDate: newReleaseDate,
			externalLink: this.fieldLink,
			seasons,
			dateStarted: this.fieldDateStarted || null,
			dateFinished: this.fieldDateFinished || null,
			manualPosterUrl: this.fieldPosterUrl.trim(),
			manualTrailerUrl: this.fieldTrailerUrl.trim(),
		};

		// Auto-mark all episodes watched when status is set to Completed
		if (updated.status === 'Completed' && updated.totalEpisodes > 0) {
			updated.watchedEpisodes = Array.from({ length: updated.totalEpisodes }, (_, i) => i + 1);
		}

		await this.dataManager.updateTitle(updated);

		// Sync updated releaseDate to any existing 'once' airtime entry
		const allEntries = this.dataManager.getAirtimeEntries();
		const existingAirtimeEntry = allEntries.find((e) => e.titleId === updated.id);
		if (existingAirtimeEntry && existingAirtimeEntry.schedule.recurrence === 'once') {
			const newDateForEntry = newReleaseDate ?? undefined;
			if (existingAirtimeEntry.schedule.releaseDate !== newDateForEntry) {
				existingAirtimeEntry.schedule.releaseDate = newDateForEntry;
				await this.dataManager.updateAirtimeEntry(existingAirtimeEntry);
			}
		}

		// ── handle releaseDate changes ───────────────────────────────────────────────
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const isFullDate = (d: string | null): d is string =>
			d !== null && /^\d{4}-\d{2}-\d{2}$/.test(d);

		if (isFullDate(newReleaseDate)) {
			const releaseMs = new Date(newReleaseDate + 'T12:00:00').getTime();
			const isFuture = releaseMs > today.getTime();

			if (isFuture) {
				if (updated.status !== 'To be released') {
					updated.status = 'To be released';
					await this.dataManager.updateTitle(updated);
				}
				// Auto-add to Upcoming if not already there
				const entries = this.dataManager.getAirtimeEntries();
				const alreadyInUpcoming = entries.some((e) => e.titleId === updated.id);
				if (!alreadyInUpcoming) {
					await this.dataManager.autoAddToUpcoming(updated);
				}
			} else {
				// Date is past/today — revert "To be released" status
				if (updated.status === 'To be released') {
					updated.status = 'Plan to watch';
					await this.dataManager.updateTitle(updated);
					await this.dataManager.removeAirtimeEntriesForTitle(updated.id);
				}
			}
		} else if (!newReleaseDate && updated.status === 'To be released') {
			// Date cleared — revert "To be released" status
			updated.status = 'Plan to watch';
			await this.dataManager.updateTitle(updated);
			await this.dataManager.removeAirtimeEntriesForTitle(updated.id);
		}

		// ── Group membership (move / create), mirroring AddTitleModal ────────────────
		// Only act when the selection changed relative to the title's original group.
		const newGroupName = this.newGroupName.trim();
		const groupChanged = newGroupName !== '' || this.selectedGroupId !== this.originalGroupId;
		if (groupChanged) {
			// Detach from the previous group first.
			if (this.originalGroupId) {
				const old = this.dataManager.getGroup(this.originalGroupId);
				if (old) {
					old.titleIds = old.titleIds.filter((id) => id !== updated.id);
					await this.dataManager.updateGroup(old);
				}
			}
			if (newGroupName) {
				const group: WatchLogGroup = {
					id: this.dataManager.generateGroupId(newGroupName),
					name: newGroupName,
					titleIds: [updated.id],
					dateAdded: new Date().toISOString(),
				};
				await this.dataManager.addGroup(group);
			} else if (this.selectedGroupId) {
				await this.dataManager.addTitleToGroup(this.selectedGroupId, updated.id);
			}
			// else: moved to "— none —" — detached only.
		}

		new Notice(`"${titleName}" updated.`);
		this.close();
		this.onSaved();
	}
}

import { App, Modal, Notice } from 'obsidian';
import { blockDuplicate, createDuplicateGuard } from './ui/DuplicateGuard';
import {
	linkField,
	makeCell,
	makeRow as makeFormRow,
	nameSelect,
	numberInput,
	renderGroupPicker,
	titleField,
	type GroupPickerState,
} from './ui/FormCells';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { WatchLogTitle, WatchLogGroup, Season } from './types';

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

/** Serializes a sorted number array back into "5,8,33-37,42". */
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

/** Parses a seasons textarea ("Name: N" or "Name: N (skip_spec)" per line) back to Season[]. */
function parseSeasonsText(text: string): Season[] {
	const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
	const seasons: Season[] = [];
	let offset = 0;
	for (const line of lines) {
		// match "Name: N", optionally followed by " (skip_spec)"
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

	// editable state. Status, priority, rating, notes, the watch dates and the release date are
	// deliberately absent — they're edited in the detail modal and the expanded row, and carry over
	// untouched on save.
	private fieldTitle: string;
	private fieldType: string;
	private fieldEpisodes: number;
	private fieldDuration: number;
	private fieldLink: string;
	private fieldSeasonsText: string;
	private fieldReview: string;
	private fieldPosterUrl: string;
	private fieldTrailerUrl: string;
	// group assignment (mirrors AddTitleModal). `originalGroupId` records the group on open, so save
	// moves/detaches only when it changed.
	private originalGroupId = '';
	private group: GroupPickerState = { selectedGroupId: '', newGroupName: '' };
	private duplicates = createDuplicateGuard();

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

		this.fieldTitle = title.title;
		this.fieldType = title.type;
		this.fieldEpisodes = title.totalEpisodes;
		this.fieldDuration = title.episodeDuration;
		this.fieldLink = title.externalLink;
		this.fieldSeasonsText = seasonsToText(title.seasons);
		this.fieldReview = title.review ?? '';
		this.fieldPosterUrl = title.posterUrl === 'none' ? '' : title.posterUrl ?? '';
		this.fieldTrailerUrl = title.manualTrailerUrl ?? '';
		// seed the group dropdown with the title's current group
		this.originalGroupId =
			this.dataManager.getGroups().find((g) => g.titleIds.includes(title.id))?.id ?? '';
		this.group.selectedGroupId = this.originalGroupId;
	}

	onOpen(): void {
		this.titleEl.setText(`Edit: ${this.original.title}`);
		this.contentEl.addClass('wl-add-modal');
		this.buildUI();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private buildUI(): void {
		const content = this.contentEl;
		content.empty();

		const makeRow = (label: string): HTMLElement => makeFormRow(content, label);

		titleField(content, this.fieldTitle, undefined, (v) => { this.fieldTitle = v; });

		nameSelect(makeRow('Type'), this.plugin.settings.types.map((t) => t.name), this.fieldType,
			(v) => { this.fieldType = v; });

		// total episodes + ep. duration paired on one row (episodes keeps its seasons skip/watch inline
		// labels — only the layout changed)
		const epsDurRow = content.createDiv({ cls: 'wl-modal-row wl-modal-row-pair' });
		const epsCell = makeCell(epsDurRow, 'Total episodes');
		numberInput(epsCell, {
			value: this.fieldEpisodes,
			min: 0,
			onInput: (v) => {
				this.fieldEpisodes = v;
				updateSkipCounts();
			},
		});
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

		numberInput(makeCell(epsDurRow, 'Ep. duration (min)', true), {
			value: this.fieldDuration,
			min: 0,
			onInput: (v) => { this.fieldDuration = v; },
		});

		linkField(content, this.fieldLink, 'HTTPS://...', (v) => { this.fieldLink = v; });

		// poster URL (the note's `poster` field)
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
			text: 'Stored in the note. Leave blank to let WatchLog fetch one again.',
		});

		// trailer URL (manual override)
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

		// group assignment (move / create), seeded with the title's current group
		renderGroupPicker(content, this.dataManager.getGroups(), this.group);

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

		const btnRow = content.createDiv({ cls: 'wl-modal-btn-row' });
		const cancelBtn = btnRow.createEl('button', { cls: 'wl-btn', text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Save changes' });
		saveBtn.addEventListener('click', () => void this.saveTitle());
	}

	private async saveTitle(): Promise<void> {
		const titleName = this.fieldTitle.trim();
		if (!titleName) {
			new Notice('Title name cannot be empty.');
			return;
		}

		const isDuplicate = this.dataManager.getTitles().some(
			(t) => t.id !== this.original.id && t.title.toLowerCase() === titleName.toLowerCase()
		);
		const blocked = blockDuplicate(this.contentEl, this.duplicates, {
			name: titleName,
			isDuplicate,
			verb: 'Save',
			retry: () => void this.saveTitle(),
		});
		if (blocked) return;

		const seasons = parseSeasonsText(this.fieldSeasonsText);

		// status, priority, rating, notes, the watch dates and the release date aren't edited here —
		// spreading the original carries their current values through, so a save can't clobber an edit made
		// elsewhere
		const updated: WatchLogTitle = {
			...this.original,
			title: titleName,
			type: this.fieldType,
			review: this.fieldReview,
			totalEpisodes: this.fieldEpisodes,
			episodeDuration: this.fieldDuration,
			externalLink: this.fieldLink,
			seasons,
			posterUrl: this.fieldPosterUrl.trim() || (this.original.posterUrl === 'none' ? 'none' : ''),
			manualTrailerUrl: this.fieldTrailerUrl.trim(),
		};

		// keep an already-Completed title fully ticked when its episode count changes here
		if (updated.status === 'Completed' && updated.totalEpisodes > 0) {
			updated.watchedEpisodes = Array.from({ length: updated.totalEpisodes }, (_, i) => i + 1);
		}

		await this.dataManager.updateTitle(updated);

		// group membership (move / create) — only act when the selection changed relative to the original
		const newGroupName = this.group.newGroupName.trim();
		const groupChanged = newGroupName !== '' || this.group.selectedGroupId !== this.originalGroupId;
		if (groupChanged) {
			// detach from the previous group first
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
			} else if (this.group.selectedGroupId) {
				await this.dataManager.addTitleToGroup(this.group.selectedGroupId, updated.id);
			}
			// else: moved to "— none —" — detached only
		}

		new Notice(`"${titleName}" updated.`);
		this.close();
		this.onSaved();
	}
}

import { App, Notice } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { MaybeTitle } from './types';
import { formatDateDisplay } from './types';
import {
	renderMediaFields,
	resetForm,
	type MediaFields,
} from './ui/FormCells';
import {
	episodesLabel,
	fillMediaFields,
	resolvePick,
	searchTitles,
	titlePickerBase,
	type TitleSearchResult,
} from './titleSearch';
import { SearchFormModal, type SearchPickerOptions } from './ui/SearchFormModal';

export class MaybeAddModal extends SearchFormModal<TitleSearchResult> {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private onAdded: () => void;

	private selectedType = 'Anime';

	private media: MediaFields = { title: '', episodes: 0, duration: 0, releaseDate: '', link: '' };

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		dataManager: DataManager,
		onAdded: () => void,
	) {
		super(app, 'Add to maybe', ['wl-add-modal']);
		this.plugin = plugin;
		this.dataManager = dataManager;
		this.onAdded = onAdded;
	}

	protected pickerOptions(): SearchPickerOptions<TitleSearchResult> {
		return titlePickerBase(this.plugin, this.selectedType, (v) => {
			this.selectedType = v;
			this.renderForm();
		});
	}

	protected noApiMessage(): string | null {
		return null;
	}

	protected async search(query: string, year: string): Promise<TitleSearchResult[]> {
		const found = await searchTitles(this.plugin, this.selectedType, query, year);
		if (found) return found;
		new Notice(`No API configured for type "${this.selectedType}". Configure it in Settings → API.`);
		return [];
	}

	protected renderResult(host: HTMLElement, result: TitleSearchResult, select: (itemEl: HTMLElement) => void): HTMLElement {
		const item = host.createDiv({ cls: 'wl-result-item' });
		item.createDiv({ cls: 'wl-result-title', text: result.title });
		item.createDiv({ cls: 'wl-result-meta', text: `${episodesLabel(result)} · ${formatDateDisplay(result.releaseDate)}` });
		item.addEventListener('click', () => select(item));
		return item;
	}

	protected async selectResult(result: TitleSearchResult, isCurrent: () => boolean): Promise<void> {
		if (await resolvePick(this.plugin, result, isCurrent, (pick) => fillMediaFields(this.media, pick))) this.renderForm();
	}

	protected renderForm(): void {
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

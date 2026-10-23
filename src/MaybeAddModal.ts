import { App, Modal, Notice } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { MaybeTitle } from './types';
import { formatDateDisplay } from './types';
import {
	makeRow,
	nameSelect,
	renderMediaFields,
	resetForm,
	type MediaFields,
} from './ui/FormCells';
import { SEARCH_PAGE_SIZE } from './ApiService';
import { fetchMediaDetails, isAnimeResult, searchTitles, type TitleSearchResult } from './titleSearch';
import { createSearchPicker, type SearchPicker } from './ui/SearchPicker';

type SearchResult = TitleSearchResult;

export class MaybeAddModal extends Modal {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private onAdded: () => void;

	private selectedType = 'Anime';


	private media: MediaFields = { title: '', episodes: 0, duration: 0, releaseDate: '', link: '' };
	private formEl: HTMLElement | null = null;
	private picker: SearchPicker;

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
		this.picker = createSearchPicker<SearchResult>({
			placeholder: 'Search for a title...',
			withYear: true,
			pageSize: SEARCH_PAGE_SIZE,
			search: (query, year) => this.searchApi(query, year),
			noApiMessage: () => null,
			renderResult: (host, result, select) => this.renderResult(host, result, select),
			onSelect: (result, isCurrent) => this.selectResult(result, isCurrent),
		});
	}

	onOpen(): void {
		this.titleEl.setText('Add to maybe');
		this.contentEl.addClass('wl-add-modal');
		this.buildUI();
	}

	onClose(): void {
		this.contentEl.empty();
		this.picker.destroy();
	}

	private buildUI(): void {
		const content = this.contentEl;
		content.empty();

		nameSelect(makeRow(content, 'Type'), this.plugin.settings.types.map((t) => t.name), this.selectedType, (v) => {
			this.selectedType = v;
			this.picker.reset();
			this.renderForm();
		});

		this.picker.mount(content);
		this.formEl = content.createDiv({ cls: 'wl-modal-form' });
		this.renderForm();
	}

	private async searchApi(query: string, year: string): Promise<SearchResult[]> {
		const found = await searchTitles(this.plugin, this.selectedType, query, year);
		if (found) return found;
		new Notice(`No API configured for type "${this.selectedType}". Configure it in Settings → API.`);
		return [];
	}

	private renderResult(host: HTMLElement, result: SearchResult, select: (itemEl: HTMLElement) => void): HTMLElement {
		const item = host.createDiv({ cls: 'wl-result-item' });
		const epText = isAnimeResult(result) ? `${result.episodes} eps` : result.episodes > 0 ? `${result.episodes} eps` : result.mediaType;
		item.createDiv({ cls: 'wl-result-title', text: result.title });
		item.createDiv({ cls: 'wl-result-meta', text: `${epText} · ${formatDateDisplay(result.releaseDate)}` });
		item.addEventListener('click', () => select(item));
		return item;
	}

	private async selectResult(result: SearchResult, isCurrent: () => boolean): Promise<void> {
		try {
			if (isAnimeResult(result)) {
				this.fillFields(result.title, result.episodes, result.duration, result.releaseDate, result.url);
			} else {
				const full = await fetchMediaDetails(this.plugin, result);
				if (!isCurrent()) return;
				if (full) this.fillFields(full.title, full.episodes, full.episodeDuration, full.releaseDate, full.url);
			}
		} catch {
			if (!isCurrent()) return;
			const duration = isAnimeResult(result) ? result.duration : result.episodeDuration;
			this.fillFields(result.title, result.episodes, duration, result.releaseDate, result.url);
		}
		if (!isCurrent()) return;
		this.renderForm();
	}

	private fillFields(title: string, episodes: number, duration: number, releaseDate: string, link: string): void {
		this.media.title = title;
		this.media.episodes = episodes;
		this.media.duration = duration;
		this.media.releaseDate = releaseDate;
		this.media.link = link;
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

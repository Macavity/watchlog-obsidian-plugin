import { App, Modal } from 'obsidian';

export type DraftAddChoice = 'watchlist' | 'book' | 'manga' | 'game';

/**
 * Choice modal shown when adding a draft: four inline options (Watchlist / Book / Manga / Game),
 * each routing to its own Add modal. The draft's text is the subtitle.
 */
export class DraftChoiceModal extends Modal {
	constructor(
		app: App,
		private draftText: string,
		private onChoice: (choice: DraftAddChoice) => void,
		private heading = 'Add draft',
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wl-draft-choice-modal');

		this.titleEl.setText(this.heading);
		contentEl.createDiv({ cls: 'wl-draft-choice-subtitle', text: this.draftText });

		const grid = contentEl.createDiv({ cls: 'wl-draft-choice-grid' });

		const makeOption = (label: string, choice: DraftAddChoice): void => {
			const btn = grid.createEl('button', { cls: 'wl-draft-choice-btn' });
			btn.createDiv({ cls: 'wl-draft-choice-label', text: label });
			btn.addEventListener('click', () => {
				this.close();
				this.onChoice(choice);
			});
		};

		makeOption('Add in Watchlist', 'watchlist');
		makeOption('Add book', 'book');
		makeOption('Add manga', 'manga');
		makeOption('Add to Games', 'game');
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

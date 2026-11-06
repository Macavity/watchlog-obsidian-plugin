import { App, Modal } from 'obsidian';
import { t } from './i18n';
import { renderChoiceGrid } from './ui/choiceGrid';

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
		private heading = t('misc.draftChoice.heading'),
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wl-draft-choice-modal');

		this.titleEl.setText(this.heading);
		contentEl.createDiv({ cls: 'wl-draft-choice-subtitle', text: this.draftText });

		renderChoiceGrid<DraftAddChoice>(
			contentEl,
			[
				{ label: t('misc.draftChoice.addWatchlist'), choice: 'watchlist' },
				{ label: t('misc.draftChoice.addBook'), choice: 'book' },
				{ label: t('misc.draftChoice.addManga'), choice: 'manga' },
				{ label: t('misc.draftChoice.addGame'), choice: 'game' },
			],
			(choice) => {
				this.close();
				this.onChoice(choice);
			},
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

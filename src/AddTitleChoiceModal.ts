import { App, Modal } from 'obsidian';
import { t } from './i18n';
import { renderChoiceGrid } from './ui/choiceGrid';

export type AddTitleChoice = 'url' | 'manual';

/**
 * Chooser shown when adding a title to the Watchlist: Add from URL, or Add manually / via API. This
 * modal only routes — no form logic.
 */
export class AddTitleChoiceModal extends Modal {
	constructor(
		app: App,
		private onChoice: (choice: AddTitleChoice) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wl-draft-choice-modal');

		this.titleEl.setText(t('add.choice.title'));

		renderChoiceGrid<AddTitleChoice>(
			contentEl,
			[
				{ label: t('add.choice.fromUrl'), choice: 'url' },
				{ label: t('add.choice.manual'), choice: 'manual' },
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

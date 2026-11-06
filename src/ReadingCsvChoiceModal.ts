import { App, Modal } from 'obsidian';
import { t } from './i18n';

export type ReadingCsvKind = 'book' | 'manga';

/**
 * Gate modal for Reading CSV import/export (the "Add draft" choice-modal shape): pick Books or
 * Manga, then the kind-specific Reading CSV modal opens.
 */
export class ReadingCsvChoiceModal extends Modal {
	constructor(
		app: App,
		private mode: 'export' | 'import',
		private onChoice: (kind: ReadingCsvKind) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wl-draft-choice-modal');

		this.titleEl.setText(this.mode === 'export' ? t('csv.exportTitle') : t('csv.importTitle'));
		contentEl.createDiv({
			cls: 'wl-draft-choice-subtitle',
			text: this.mode === 'export'
				? t('csv.chooseExport')
				: t('csv.chooseImport'),
		});

		const grid = contentEl.createDiv({ cls: 'wl-draft-choice-grid' });

		const makeOption = (label: string, kind: ReadingCsvKind): void => {
			const btn = grid.createEl('button', { cls: 'wl-draft-choice-btn' });
			btn.createDiv({ cls: 'wl-draft-choice-label', text: label });
			btn.addEventListener('click', () => {
				this.close();
				this.onChoice(kind);
			});
		};

		makeOption(t('csv.library.book'), 'book');
		makeOption(t('csv.library.manga'), 'manga');
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

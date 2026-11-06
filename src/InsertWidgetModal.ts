import { App, FuzzySuggestModal } from 'obsidian';
import type { WatchLogTitle } from './types';
import { t } from './i18n';
import { typeLabel } from './i18n/labels';

export class InsertWidgetModal extends FuzzySuggestModal<WatchLogTitle> {
	private onSelect: (title: WatchLogTitle) => void;
	private titles: WatchLogTitle[];

	constructor(app: App, titles: WatchLogTitle[], onSelect: (title: WatchLogTitle) => void) {
		super(app);
		this.titles = titles;
		this.onSelect = onSelect;
		this.setPlaceholder(t('widget.insertPlaceholder'));
	}

	getItems(): WatchLogTitle[] {
		return this.titles;
	}

	getItemText(title: WatchLogTitle): string {
		return `${title.title} (${typeLabel(title.type)})`;
	}

	onChooseItem(title: WatchLogTitle): void {
		this.onSelect(title);
	}
}

import { App, Modal, setIcon } from 'obsidian';
import type { SearchFieldSpec } from './SearchQuery';

/** A query rendered as coloured parts: v = value, f = field prefix, o = operator. */
type Part = [kind: 'v' | 'f' | 'o' | 'p', text: string];

interface HelpExample {
	parts: Part[];
	says: string;
}

// deliberately abstract — colour words, never real titles or people
const EXAMPLES: HelpExample[] = [
	{
		parts: [['v', 'red'], ['p', ' '], ['v', 'blue']],
		says: 'Both must match. They can match different fields — one in cast, one in studio.',
	},
	{
		parts: [['o', '"'], ['v', 'red blue'], ['o', '"']],
		says: 'Exact phrase, kept together, no typo tolerance.',
	},
	{
		parts: [['f', 'director:'], ['v', 'red']],
		says: 'One field only.',
	},
	{
		parts: [['v', 'red'], ['p', ' '], ['o', '|'], ['p', ' '], ['v', 'blue']],
		says: 'Either one. Widens instead of narrowing.',
	},
	{
		parts: [['v', 'red'], ['p', ' '], ['o', '-'], ['v', 'blue']],
		says: 'Minus excludes.',
	},
	{
		parts: [['f', 'year:'], ['o', '>'], ['v', '2020']],
		says: 'Ranges: > < >= <= or a plain number.',
	},
	{
		parts: [['f', 'cast:'], ['v', 'red'], ['p', ' '], ['f', 'studio:'], ['v', 'blue'], ['p', ' '], ['f', 'rating:'], ['o', '>='], ['v', '4']],
		says: 'Mix freely.',
	},
];

/**
 * The "?" panel next to each search box. Lists the syntax plus the fields the *current* tab
 * searches, since those differ (Games has platforms, Reading has your custom columns).
 */
export class SearchHelpModal<T> extends Modal {
	constructor(
		app: App,
		private tabLabel: string,
		private fields: SearchFieldSpec<T>[],
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wl-search-help');
		this.titleEl.setText('Search tips');

		contentEl.createDiv({
			cls: 'wl-search-help-intro',
			text: 'Every word has to match, but they can match different fields.',
		});

		const list = contentEl.createDiv({ cls: 'wl-search-help-list' });
		for (const ex of EXAMPLES) {
			const row = list.createDiv({ cls: 'wl-search-help-row' });
			const q = row.createDiv({ cls: 'wl-search-help-query' });
			for (const [kind, text] of ex.parts) {
				q.createSpan({ cls: `wl-shq-${kind}`, text });
			}
			row.createDiv({ cls: 'wl-search-help-says', text: ex.says });
		}

		const textFields = this.fields.filter((f) => f.text);
		const numFields = this.fields.filter((f) => f.number);

		const fieldsWrap = contentEl.createDiv({ cls: 'wl-search-help-fields' });

		fieldsWrap.createDiv({ cls: 'wl-search-help-fields-title', text: `${this.tabLabel} searches` });
		const textRow = fieldsWrap.createDiv({ cls: 'wl-search-help-chips' });
		for (const f of textFields) {
			textRow.createSpan({ cls: 'wl-search-help-chip wl-shq-f', text: f.name });
		}
		if (textFields.length === 0) textRow.createSpan({ cls: 'wl-search-help-chip', text: '—' });

		if (numFields.length > 0) {
			fieldsWrap.createDiv({ cls: 'wl-search-help-fields-title', text: 'Number ranges' });
			const numRow = fieldsWrap.createDiv({ cls: 'wl-search-help-chips' });
			for (const f of numFields) {
				numRow.createSpan({ cls: 'wl-search-help-chip wl-shq-o', text: `${f.name}:` });
			}
		}

		contentEl.createDiv({
			cls: 'wl-search-help-note',
			text: 'Typos are tolerated. A "+" in a name needs no escaping, and a colon that is not a field above stays part of the search.',
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Adds the "?" button to a search wrapper. One call per tab, so the three search bars keep their own
 * debounce and rerender wiring.
 */
export function renderSearchHelpButton<T>(
	wrap: HTMLElement,
	app: App,
	tabLabel: string,
	fields: () => SearchFieldSpec<T>[],
): HTMLElement {
	const btn = wrap.createEl('button', {
		cls: 'wl-search-help-btn',
		attr: { type: 'button', 'aria-label': 'Search tips' },
	});
	setIcon(btn, 'help-circle');
	btn.addEventListener('click', () => {
		new SearchHelpModal(app, tabLabel, fields()).open();
	});
	return btn;
}

import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import de from '../../src/i18n/de';
import { GamesTab } from '../../src/GamesTab';
import { ReadingManageColumnsModal } from '../../src/ReadingManageColumnsModal';
import { ReadingTab } from '../../src/ReadingTab';
import { El } from '../helpers/fakeEl';

afterEach(() => setLocale('en'));

function allText(el: El): string[] {
	return [el.text, ...Object.values(el.attr), ...el.children.flatMap(allText)].filter(Boolean);
}

describe('reading and games i18n', () => {
	it('renders the reading empty state in German', () => {
		setLocale('de');
		const container = new El('root');
		const tab = new ReadingTab(container as never, {} as never, {
			onChange: () => {}, offChange: () => {},
			getSettings: () => ({ defaultSubTab: 'books' }),
			getBooks: () => [],
		} as never);
		(tab as unknown as { contentEl: El }).contentEl = container;
		(tab as unknown as { renderContent: () => void }).renderContent();
		const texts = allText(container);
		expect(texts).toContain(de.reading.empty.linkBook);
		expect(de.reading.empty.linkBook).not.toBe('add your first book');
	});

	it('renders the manage fields modal in German', () => {
		setLocale('de');
		const modal = new ReadingManageColumnsModal({} as never, { settings: {} } as never, {
			getSettings: () => ({}),
			getBookColumns: () => [],
			getMangaColumns: () => [],
		} as never, 'book', () => {});
		const internals = modal as unknown as {
			renderStyleToggle: (parent: El) => void;
			renderList: () => void;
			listEl: El;
		};
		const parent = new El('root');
		internals.renderStyleToggle(parent);
		internals.listEl = new El('root');
		internals.renderList();
		expect(allText(parent)).toContain(de.reading.columns.displayStyle);
		expect(allText(parent)).toContain(de.reading.columns.styleFill);
		expect(allText(internals.listEl)).toContain(de.reading.columns.empty);
	});

	it('renders the games empty state in German', () => {
		setLocale('de');
		const container = new El('root');
		const tab = new GamesTab(container as never, { settings: {} } as never, {
			onChange: () => {}, offChange: () => {},
			getSavedFilterPreset: () => null,
			getGames: () => [],
			getGroups: () => [],
		} as never);
		(tab as unknown as { contentEl: El }).contentEl = container;
		(tab as unknown as { renderContent: () => void }).renderContent();
		expect(allText(container)).toContain(de.games.empty);
		expect(de.games.empty).not.toBe('No games yet; click + Add to track your first game.');
	});
});

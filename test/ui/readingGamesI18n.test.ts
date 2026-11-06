import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import de from '../../src/i18n/de';
import { GamesTab } from '../../src/GamesTab';
import { GameDetailModal } from '../../src/GameDetailModal';
import { defaultGamesSettings, DEFAULT_SETTINGS } from '../../src/types';
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

	it('shows the game status and priority pills in German while values stay English', () => {
		setLocale('de');
		const game = { id: 'g1', title: 'Hades', status: 'Playing', priority: 'High', type: '', platforms: [] };
		const modal = new GameDetailModal(
			{} as never,
			{ settings: { priorities: DEFAULT_SETTINGS.priorities.map((p) => ({ name: p.name })) } } as never,
			{ getGroups: () => [], getSettings: () => ({ ...defaultGamesSettings(), statuses: defaultGamesSettings().statuses.map((s) => ({ name: s.name })) }) } as never,
			game as never,
		);
		const badgeRow = new El('div') as El & { empty: () => void };
		badgeRow.empty = () => { badgeRow.children = []; };
		Object.assign(modal as object, { badgeRowEl: badgeRow, contentEl: new El('div'), mobile: true });
		(modal as unknown as { renderBadgeRow: () => void }).renderBadgeRow();
		const texts = allText(badgeRow);
		expect(texts).toContain('Spiele');
		expect(texts).toContain('Hoch');
		expect(texts).not.toContain('Playing');
		expect((modal as unknown as { draft: { status: string } }).draft.status).toBe('Playing');
	});
});

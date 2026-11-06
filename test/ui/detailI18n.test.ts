import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import de from '../../src/i18n/de';
import { renderCommunityRating } from '../../src/CommunityRating';
import { GroupDetailModal, renderCreditsRows } from '../../src/TitleDetailModal';
import { GameGroupDetailModal } from '../../src/GameDetailModal';
import { El } from '../helpers/fakeEl';
import { makeTitle } from '../helpers/setupDataManager';

const styleDescriptor = Object.getOwnPropertyDescriptor(El.prototype, 'style');
beforeAll(() => {
	// the group headers set a bar width; the element double has no style object
	Object.defineProperty(El.prototype, 'style', { get: () => ({}), configurable: true });
});
afterAll(() => {
	if (styleDescriptor) Object.defineProperty(El.prototype, 'style', styleDescriptor);
	else delete (El.prototype as unknown as Record<string, unknown>).style;
});
afterEach(() => setLocale('en'));

function allText(el: El): string[] {
	return [el.text, ...Object.values(el.attr), ...el.children.flatMap(allText)].filter(Boolean);
}

describe('detail modals i18n', () => {
	it('renders the community rating badge in German', () => {
		setLocale('de');
		const parent = new El('root');
		const title = makeTitle({ id: 'a' });
		const plugin = { dataManager: { getTitle: () => title } };
		renderCommunityRating(parent as never, plugin as never, 'a');
		const texts = allText(parent);
		expect(texts).toContain(de.detail.community.empty);
		expect(texts).toContain(de.detail.community.refresh);
	});

	it('renders the group modal header in German', () => {
		setLocale('de');
		const modal = new GroupDetailModal({} as never, {
			settings: {},
			dataManager: { getEffectiveTotal: () => 0 },
		} as never, { name: 'Marvel' } as never, []);
		(modal as unknown as { renderAll: () => void }).renderAll();
		const texts = allText(modal.contentEl as unknown as El);
		expect(texts).toContain('0 Titel');
		expect(texts).toContain(de.list.stat.progress);
	});

	it('renders the game group modal count in German', () => {
		setLocale('de');
		const modal = new GameGroupDetailModal({} as never, {
			settings: {},
		} as never, {
			getSettings: () => ({ types: [], statuses: [] }),
		} as never, { name: 'Zelda' } as never, []);
		(modal as unknown as { renderAll: () => void }).renderAll();
		expect(allText(modal.contentEl as unknown as El)).toContain('0 Spiele');
	});

	it('picks singular and plural studio labels', () => {
		const render = (studio: string[]): string[] => {
			const parent = new El('root');
			renderCreditsRows(parent as never, makeTitle({ studio, director: ['D'] }), { includeStudio: true });
			return allText(parent);
		};
		setLocale('de');
		expect(render(['A'])).toContain('Studio');
		expect(render(['A', 'B'])).toContain('Studios');
		expect(render(['A'])).not.toContain('Director');
		expect(render(['A'])).toContain(de.list.searchField.director);
	});
});

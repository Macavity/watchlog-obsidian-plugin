import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import de from '../../src/i18n/de';
import { WidgetRenderer } from '../../src/WidgetRenderer';
import { CustomListsTab } from '../../src/CustomListsTab';
import { DraftsTab } from '../../src/DraftsTab';
import { InsertWidgetModal } from '../../src/InsertWidgetModal';
import { El } from '../helpers/fakeEl';

afterEach(() => setLocale('en'));

const asEl = (el: El): HTMLElement => el as unknown as HTMLElement;
const texts = (el: El): string[] => [el.text, ...el.children.flatMap(texts)];

describe('widget i18n', () => {
	function processors(): Map<string, (source: string, el: HTMLElement) => void> {
		const map = new Map<string, (source: string, el: HTMLElement) => void>();
		const g = globalThis as Record<string, unknown>;
		g.activeDocument = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
		const plugin = {
			registerMarkdownCodeBlockProcessor: (lang: string, fn: (s: string, e: HTMLElement) => void) => map.set(lang, fn),
			register: () => {},
			settings: { types: [], statuses: [], coloredTypeBadges: false },
		};
		const dm = { getAirtimeEntries: () => [], getTitles: () => [], getPinnedGroupId: () => null, getGroups: () => [] };
		new WidgetRenderer(plugin as never, dm as never);
		return map;
	}

	it('renders widget chrome in the active locale', () => {
		const map = processors();
		setLocale('de');
		const empty = new El('div');
		map.get('wl-upcoming')!('next full', asEl(empty));
		expect(texts(empty)).toContain(de.widget.noUpcomingTitles);
		expect(texts(empty)).toContain(de.widget.upNext);

		const unknown = new El('div');
		map.get('wl-stat')!('bogus', asEl(unknown));
		expect(texts(unknown)).toContain(`wl-stat: ${de.widget.unknownStat.replace('{kind}', 'bogus')}`);
	});

	it('keeps English by default', () => {
		const empty = new El('div');
		processors().get('wl-upcoming')!('next full', asEl(empty));
		expect(texts(empty)).toContain('No upcoming titles.');
	});

	it('localizes the insert modal placeholder', () => {
		setLocale('de');
		let placeholder = '';
		const proto = InsertWidgetModal.prototype as unknown as { setPlaceholder: (p: string) => void };
		const orig = proto.setPlaceholder;
		proto.setPlaceholder = (p: string) => { placeholder = p; };
		try {
			new InsertWidgetModal({} as never, [], () => {});
		} finally {
			proto.setPlaceholder = orig;
		}
		expect(placeholder).toBe(de.widget.insertPlaceholder);
	});
});

describe('custom lists and drafts i18n', () => {
	it('renders the custom lists empty state in German', () => {
		setLocale('de');
		const root = new El('div');
		const tab = new CustomListsTab(asEl(root), { app: {}, settings: {} } as never, {} as never);
		(tab as unknown as { buildEmptyState: () => void }).buildEmptyState();
		expect(texts(root)).toContain(de.lists.emptyText);
		expect(texts(root)).toContain(de.lists.createFirst);
	});

	it('renders drafts chrome in German', () => {
		setLocale('de');
		const root = new El('div');
		const plugin = {
			settings: { showHintBanners: false, draftsVaultTag: '#watchlog' },
			dataManager: { getTitles: () => [] },
			readingDataManager: { getBooks: () => [], getMangaList: () => [] },
			gameDataManager: { getGames: () => [] },
		};
		const tab = new DraftsTab(asEl(root), plugin as never, {} as never, () => {});
		(tab as unknown as { renderUI: (e: unknown[]) => void }).renderUI([]);
		expect(texts(root)).toContain(` ${de.drafts.pending.other}`);
		expect(texts(root)).toContain(de.drafts.empty.replace('{tag}', '#watchlog'));
	});
});

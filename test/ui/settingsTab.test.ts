import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../src/i18n';
import de from '../../src/i18n/de';
import { WatchLogSettingsTab } from '../../src/SettingsTab';
import { DEFAULT_SETTINGS } from '../../src/types';
import { El } from '../helpers/fakeEl';
import { tick } from '../helpers/common';

afterEach(() => setLocale('en'));

function allText(el: El): string[] {
	return [el.text, ...Object.values(el.attr), ...el.children.flatMap(allText)].filter(Boolean);
}

function makeTab(plugin: Record<string, unknown> = {}, section = 'general') {
	const full = {
		settings: { ...DEFAULT_SETTINGS },
		getLayout: () => ({ root: 'W' }),
		saveSettings: async () => undefined,
		...plugin,
	};
	const tab = new WatchLogSettingsTab({} as never, full as never);
	(tab as unknown as { activeSection: string }).activeSection = section;
	const root = tab.containerEl as unknown as El;
	return { tab, root };
}

describe('settings tab i18n', () => {
	it('renders group headings and setting names in German', () => {
		setLocale('de');
		const { tab, root } = makeTab();
		tab.display();
		const texts = allText(root);
		expect(texts).toContain(de.settings.group.main);
		expect(texts).toContain(de.settings.general.dateFormat.name);
		expect(de.settings.general.dateFormat.name).not.toBe('Date format');
	});

	it('shows the Steam bad-key failure in German', async () => {
		setLocale('de');
		const apiService = {
			resolveSteamId: async () => '',
			setSteamCredentials: vi.fn(),
			checkSteamConnection: async () => ({ ok: false, reason: 'badKey' }),
		};
		const { tab, root } = makeTab({ apiService }, 'api');
		tab.display();
		const steamTest = root.findAll('wl-api-test').at(-1)!;
		steamTest.fire('click');
		await tick(20);
		expect(allText(root)).toContain(de.settings.steam.badKey);
	});
});

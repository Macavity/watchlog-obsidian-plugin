import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import de from '../../src/i18n/de';
import { renderModePill } from '../../src/ModePill';
import { renderShelfTitle } from '../../src/RowsView';
import { El } from '../helpers/fakeEl';

afterEach(() => setLocale('en'));

describe('list i18n', () => {
	it('renders the mode pill in the active locale', () => {
		setLocale('de');
		const root = new El('root');
		renderModePill(root as unknown as HTMLElement, () => ({ singleplayer: false, coop: false, multiplayer: false }), () => {});
		const pill = root.find('wl-mode-pill')!;
		const coop = pill.find('wl-mode-pill-coop')!;
		expect(coop.find('wl-mode-pill-label')!.text).toBe(de.list.mode.coop.label);
		expect(coop.attr['aria-label']).toBe(de.list.mode.coop.toggle);
		expect(de.list.mode.coop.label).not.toBe('Co-op');
	});

	it('renders the shelf select label in the active locale', () => {
		setLocale('de');
		const root = new El('root');
		renderShelfTitle(root as unknown as HTMLElement, 'Favoriten', 1, {
			ids: ['a'], selected: new Set(), onToggle: () => {},
		});
		const box = root.find('wl-shelf-select')!;
		expect(box.attr['aria-label']).toBe(de.list.rows.selectAllIn.replace('{label}', 'Favoriten'));
	});
});

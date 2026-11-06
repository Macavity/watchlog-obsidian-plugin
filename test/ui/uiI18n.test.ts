import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import de from '../../src/i18n/de';
import { columnsProblemText } from '../../src/ui/ColumnsEditor';
import { typeNameProblemText } from '../../src/ui/problemText';
import { renderSelectionButtons } from '../../src/ui/TabToolbar';
import { El } from '../helpers/fakeEl';

afterEach(() => setLocale('en'));

describe('ui i18n', () => {
	it('renders type name problems in the active locale', () => {
		expect(typeNameProblemText('Anime')).toBeNull();
		expect(typeNameProblemText('Books')).toBe('"Books" is a reserved folder name.');
		setLocale('de');
		expect(typeNameProblemText('Books')).toBe(de.ui.typeName.reserved.replace('{name}', 'Books'));
		expect(typeNameProblemText('a/b')).toBe(de.ui.typeName.unsafe.replace('{name}', 'a/b').replace('{safe}', 'a-b'));
	});

	it('renders column problems in the active locale', () => {
		setLocale('de');
		expect(columnsProblemText({ reason: 'noOptions', label: 'Genre' }))
			.toBe(de.ui.columns.noOptions.replace('{label}', 'Genre'));
		expect(columnsProblemText({ reason: 'emptyName' })).toBe(de.ui.columns.emptyName);
	});

	it('renders component labels in the active locale', () => {
		setLocale('de');
		const parent = new El('root');
		renderSelectionButtons(parent as unknown as HTMLElement, {
			selectionMode: false, hasSelection: false, onToggleAll: () => {}, onToggleMode: () => {},
		});
		expect(parent.children[0]!.text).toBe(de.ui.toolbar.select);
		expect(de.ui.toolbar.select).not.toBe('Select');
	});
});

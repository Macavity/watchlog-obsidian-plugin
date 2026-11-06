import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import de from '../../src/i18n/de';
import { AddFromUrlModal } from '../../src/AddFromUrlModal';
import { AddReadingModal } from '../../src/AddReadingModal';
import { AddTitleChoiceModal } from '../../src/AddTitleChoiceModal';
import { EditTitleModal } from '../../src/EditTitleModal';
import { El } from '../helpers/fakeEl';

afterEach(() => setLocale('en'));

function allText(el: El): string[] {
	return [el.text, ...Object.values(el.attr), ...el.children.flatMap(allText)].filter(Boolean);
}

describe('add and edit modals i18n', () => {
	it('renders the add title chooser in German', () => {
		setLocale('de');
		const modal = new AddTitleChoiceModal({} as never, () => {});
		modal.onOpen();
		expect(modal.titleEl.text).toBe(de.add.choice.title);
		expect(modal.titleEl.text).not.toBe('Add title');
		const texts = allText(modal.contentEl);
		expect(texts).toContain(de.add.choice.fromUrl);
		expect(texts).toContain(de.add.choice.manual);
	});

	it('renders the add from URL modal in German', () => {
		setLocale('de');
		const modal = new AddFromUrlModal({} as never, {} as never, {} as never, () => {});
		modal.onOpen();
		expect(modal.titleEl.text).toBe(de.add.choice.fromUrl);
		const texts = allText(modal.contentEl);
		expect(texts).toContain(de.add.url.info);
		expect(texts).toContain(de.common.add);
	});

	it('renders the edit title heading and buttons in German', () => {
		setLocale('de');
		const modal = new EditTitleModal(
			{} as never,
			{ settings: { types: [] } } as never,
			{ getGroups: () => [] } as never,
			{ id: 'x', title: 'Dune', type: 'Movie', totalEpisodes: 1, episodeDuration: 0, externalLink: '', seasons: [], posterUrl: '' } as never,
			() => {},
		);
		modal.onOpen();
		expect(modal.titleEl.text).toBe('Bearbeiten: Dune');
		const texts = allText(modal.contentEl);
		expect(texts).toContain(de.edit.saveChanges);
		expect(texts).toContain(de.common.cancel);
	});

	it('localizes the reading modal header title', () => {
		setLocale('de');
		const modal = new AddReadingModal({} as never, {} as never, {} as never, 'book', () => {}, {
			state: {} as never, id: 'b1',
		});
		expect((modal as unknown as { headerTitle: () => string }).headerTitle()).toBe(de.add.reading.editBook);
	});
});

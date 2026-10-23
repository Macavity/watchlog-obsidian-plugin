import { describe, it, expect } from 'vitest';
import { decodeBook, decodeManga, encodeBook, encodeManga } from '../../src/storage/readingCodec';

const base = { dateAdded: '2026-01-01T00:00:00Z', dateModified: '2026-01-01T00:00:00Z' };

describe('reading codec', () => {
	it('round-trips a book with custom fields', () => {
		const fm = { title: 'Dune', author: 'Frank Herbert', status: 'Reading', rating: 4, pagesRead: 120, totalPages: 600,
			chaptersRead: 0, totalChapters: 0, googleBooksId: 'abc', cf_Format: 'Hardcover', cf_Year: 1965, ...base, type: 'book' };
		const { entry, invalidFields } = decodeBook('Books/Dune', fm);
		expect(invalidFields).toEqual([]);
		expect(entry.id).toBe('Books/Dune');
		expect(entry.customFields).toEqual({ Format: 'Hardcover', Year: 1965 });
		expect(encodeBook(entry)).toMatchObject({ cf_Format: 'Hardcover', externalId: 'gbooks:abc', pagesRead: 120, googleBooksId: 'abc' });
	});

	it('maps externalId to googleBooksId and back', () => {
		const { entry } = decodeBook('Books/X', { title: 'X', status: 'Reading', externalId: 'gbooks:zz', ...base });
		expect(entry.googleBooksId).toBe('zz');
	});

	it('round-trips manga with groups, airtime and favorite', () => {
		const fm = { title: 'Berserk', author: 'Miura', status: 'Reading', rating: 5, chaptersRead: 10, totalChapters: 364,
			volumesRead: 1, totalVolumes: 41, malId: '2', groups: ['Dark'], favorite: true, dateFavorited: '2026-02-01T00:00:00Z',
			airtimeRecurrence: 'weekly', airtimeDay: 3, airtimeTime: '09:00', airtimeSeason: 2, airtimeEpisode: 11,
			airtimeAcknowledged: '2026-10-01', ...base, type: 'manga' };
		const { entry } = decodeManga('Manga/Berserk', fm);
		expect(entry.malId).toBe('2');
		expect(entry.groups).toEqual(['Dark']);
		expect(entry.airtime).toEqual({ recurrence: 'weekly', day: 3, time: '09:00', season: 2, episode: 11, acknowledged: '2026-10-01' });
		expect(encodeManga(entry)).toMatchObject({ externalId: 'mal:manga:2', malId: '2', groups: ['Dark'], airtimeEpisode: 11,
			airtimeSeason: 2, dateFavorited: '2026-02-01T00:00:00Z', volumesRead: 1, favorite: true });
	});

	it('reports invalid fields and falls back to defaults', () => {
		const { entry, invalidFields } = decodeBook('Books/Y', { title: 'Y', status: 'Nope', pagesRead: 'many', ...base });
		expect(invalidFields).toEqual(expect.arrayContaining(['status', 'pagesRead']));
		expect(entry.pagesRead).toBe(0);
		expect(entry.status).toBe('Plan to Read');
	});

	it('omits airtime keys when no schedule', () => {
		const out = encodeBook(decodeBook('Books/Z', { title: 'Z', status: 'Reading', ...base }).entry);
		expect(Object.keys(out).some(k => k.startsWith('airtime'))).toBe(false);
	});
});

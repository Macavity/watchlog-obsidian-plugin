import { describe, expect, it } from 'vitest';
import { buildImportedTitle, missingTypeNames } from '../src/CsvModal';

describe('buildImportedTitle', () => {
	it('fills defaults for a bare entry', () => {
		const t = buildImportedTitle({ title: '  Foo ' }, 'id1', undefined);
		expect(t).toMatchObject({
			id: 'id1', title: 'Foo', type: 'Anime', status: 'Plan to watch', priority: 'Medium',
			rating: 0, notes: '', totalEpisodes: 0, episodeDuration: 0, externalLink: '',
			dateStarted: null, dateFinished: null, releaseDate: null, favorite: false,
		});
		expect(t.manualStudio).toBeUndefined();
	});

	it('uses the first configured type when the entry has none', () => {
		expect(buildImportedTitle({ title: 'A' }, 'i', 'Series').type).toBe('Series');
		expect(buildImportedTitle({ title: 'A', type: ' Movie ' }, 'i', 'Series').type).toBe('Movie');
	});

	it('marks all episodes watched for Completed with episodes', () => {
		const t = buildImportedTitle({ title: 'A', status: 'Completed', totalEpisodes: 3 }, 'i', undefined);
		expect(t.watchedEpisodes).toEqual([1, 2, 3]);
		const none = buildImportedTitle({ title: 'A', status: 'Completed' }, 'i', undefined);
		expect(none.watchedEpisodes).toEqual([]);
	});

	it('keeps imported studios in the manual slot', () => {
		expect(buildImportedTitle({ title: 'A', manualStudio: ['X'] }, 'i', undefined).manualStudio).toEqual(['X']);
	});
});

describe('missingTypeNames', () => {
	it('collects unknown entry types case-insensitively', () => {
		const out = missingTypeNames([{ type: 'anime' }, { type: 'Doku' }, { type: ' ' }, {}], ['Anime'], {});
		expect([...out]).toEqual(['Doku']);
	});

	it('adds folder-safe names marked for creation', () => {
		const out = missingTypeNames([], ['Anime'], { 'a/b': '__create__', Anime: '__create__', x: 'Anime' });
		expect([...out]).toEqual(['a-b']);
	});
});

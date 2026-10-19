import { describe, it, expect } from 'vitest';
import { decodeTitle, encodeTitle, splitCache } from '../../src/storage/titleCodec';
const seasons = [{ name: 'Season 1', episodes: 8, offset: 0 }, { name: 'Season 2', episodes: 8, offset: 8 }];
describe('titleCodec', () => {
  it('decodes an original-plugin movie note', () => {
    const { entry, invalidFields } = decodeTitle('Movie/Das doppelte Lottchen', {
      title: 'Das doppelte Lottchen', type: 'Movie', status: 'Completed', priority: 'Medium', rating: 4,
      progress: '100%', totalEpisodes: 1, episodeDuration: 89, dateStarted: '2026-10-09', dateFinished: null,
      dateAdded: '2026-10-17T10:16:25.529Z', dateModified: '2026-10-17T10:16:25.529Z', releaseDate: '2017-04-16',
      externalLink: 'https://www.imdb.com/title/tt5843312',
    }, undefined);
    expect(invalidFields).toEqual([]);
    expect(entry.id).toBe('Movie/Das doppelte Lottchen');
    expect(entry.watchedEpisodes).toEqual([1]); // Completed movie
    expect(encodeTitle(entry, 100)).not.toHaveProperty('watched');
    expect(encodeTitle(entry, 100).externalId).toBe('imdb:tt5843312');
  });
  it('round-trips series progress via cache seasons', () => {
    const fm = { title: 'Dark', type: 'TV Show', status: 'Watching', externalId: 'tmdb:tv:70523',
      watched: 'S01E01-E08, S02E01-E02', skipped: 'S02E05', dateAdded: '2026-01-01T00:00:00Z', dateModified: '2026-01-01T00:00:00Z' };
    const { entry } = decodeTitle('TV Show/Dark', fm, { seasons });
    expect(entry.watchedEpisodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(entry.seasons[1]!.skippedEpisodes).toEqual([5]);
    const out = encodeTitle(entry, 66);
    expect(out.watched).toBe('S01E01-E08, S02E01-E02');
    expect(out).not.toHaveProperty('seasons');
    expect(splitCache(entry).seasons).toEqual(seasons); // cache seasons carry no skippedEpisodes (those live in the note)
  });
  it('writes seasons only on override', () => {
    const { entry } = decodeTitle('Anime/X', { title: 'X', type: 'Anime', seasons: ['Season 1: 12'], watched: 'S01E01-E03' }, undefined);
    expect(entry.seasonsOverride).toBe(true);
    expect(encodeTitle(entry, 25).seasons).toEqual(['Season 1: 12']);
  });
  it('flags invalid fields without throwing', () => {
    const { entry, invalidFields } = decodeTitle('TV Show/Y', { title: 'Y', rating: 'great', watched: 'lots' }, undefined);
    expect(entry.rating).toBe(0);
    expect(invalidFields).toEqual(expect.arrayContaining(['rating', 'watched']));
  });
  it('maps maybe, groups and airtime', () => {
    const { entry } = decodeTitle('TV Show/Z', { title: 'Z', maybe: true, groups: ['Marvel'],
      airtimeRecurrence: 'weekly', airtimeDay: 3, airtimeTime: '18:00', airtimeEpisode: 4 }, undefined);
    expect(entry.maybe).toBe(true);
    expect(entry.airtime).toEqual({ recurrence: 'weekly', day: 3, time: '18:00', episode: 4 });
    expect(encodeTitle(entry, 0)).toMatchObject({ maybe: true, groups: ['Marvel'], airtimeRecurrence: 'weekly' });
  });
});

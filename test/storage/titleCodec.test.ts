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
  it('keeps refs outside the known seasons and writes them back unchanged', () => {
    const s1 = [{ name: 'Season 1', episodes: 8, offset: 0 }];
    const fm = { title: 'Dark', type: 'TV Show', status: 'Watching', externalId: 'tmdb:tv:70523',
      watched: 'S01E01-E08, S02E01', skipped: 'S03E02' };
    const { entry, invalidFields } = decodeTitle('TV Show/Dark', fm, { seasons: s1 });
    expect(invalidFields).toEqual([]);
    expect(entry.watchedEpisodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    entry.watchedEpisodes = entry.watchedEpisodes.filter((e) => e !== 1);
    const out = encodeTitle(entry, 50);
    expect(out.watched).toBe('S01E02-E08, S02E01');
    expect(out.skipped).toBe('S03E02');
    expect(splitCache(entry)).not.toHaveProperty('unmappedWatched');
  });
  it('marks out-of-range episode numbers invalid', () => {
    const s1 = [{ name: 'Season 1', episodes: 8, offset: 0 }];
    const beyond = decodeTitle('TV Show/A', { title: 'A', watched: 'S01E09', skipped: 'S01E10' }, { seasons: s1 });
    expect(beyond.invalidFields).toEqual([]);
    expect(beyond.entry.unmappedWatched).toEqual([{ season: 1, episode: 9 }]);
    expect(beyond.entry.unmappedSkipped).toEqual([{ season: 1, episode: 10 }]);
    expect(beyond.entry.seasons[0]?.skippedEpisodes).toEqual([]);
    expect(decodeTitle('TV Show/A', { title: 'A', watched: 'S01E10001' }, undefined).invalidFields).toContain('watched');
    expect(decodeTitle('TV Show/A', { title: 'A', seasons: ['Season 1: 12 (13)'] }, undefined).invalidFields).toContain('seasons');
    expect(decodeTitle('TV Show/A', { title: 'A', seasons: ['Season 1: 20000 (1-10001)'] }, undefined).invalidFields).toContain('seasons');
    expect(decodeTitle('TV Show/A', { title: 'A', seasons: ['Season 1: 12 (3, 5-6)'] }, undefined).invalidFields).toEqual([]);
  });

  describe('series without a season list', () => {
    const fm = { title: 'N', type: 'TV Show', totalEpisodes: 10, watched: 'S01E01-E05, S02E01', skipped: 'S01E09' };

    it('maps progress onto an implicit S01 of totalEpisodes', () => {
      const { entry, invalidFields } = decodeTitle('TV Show/N', fm, undefined);
      expect(invalidFields).toEqual([]);
      expect(entry.seasons).toEqual([]);
      expect(entry.watchedEpisodes).toEqual([1, 2, 3, 4, 5]);
      entry.watchedEpisodes.push(7);
      const out = encodeTitle(entry, 60);
      expect(out.watched).toBe('S01E01-E05, S01E07, S02E01');
      expect(out.skipped).toBe('S01E09');
      expect(splitCache(entry)).not.toHaveProperty('seasons');
    });

    it('waits while a season refill is pending', () => {
      const pending = { ...fm, externalId: 'tmdb:tv:1' };
      const { entry } = decodeTitle('TV Show/N', pending, undefined);
      expect(entry.watchedEpisodes).toEqual([]);
      expect(encodeTitle(entry, 0, true)).not.toHaveProperty('watched');
    });

    it('uses the implicit season once the refill found nothing or lacks a key', () => {
      const pending = { ...fm, externalId: 'tmdb:tv:1' };
      for (const result of ['notfound', 'nokey'] as const) {
        const { entry } = decodeTitle('TV Show/N', pending, { apiCheck: { seasons: { at: '2026-01-01T00:00:00Z', result } } });
        expect(entry.watchedEpisodes).toEqual([1, 2, 3, 4, 5]);
      }
      const transient = decodeTitle('TV Show/N', pending, { apiCheck: { seasons: { at: '2026-01-01T00:00:00Z', result: 'transient' } } });
      expect(transient.entry.watchedEpisodes).toEqual([]);
    });

    it('keeps movies without watched', () => {
      const { entry } = decodeTitle('Movie/M', { title: 'M', type: 'Movie', totalEpisodes: 1, status: 'Completed' }, undefined);
      expect(encodeTitle(entry, 100)).not.toHaveProperty('watched');
    });
  });
});

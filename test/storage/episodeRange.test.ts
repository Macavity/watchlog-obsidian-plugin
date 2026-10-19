import { describe, it, expect } from 'vitest';
import { parseEpisodeRange, formatEpisodeRange, toAbsolute, fromAbsolute } from '../../src/storage/episodeRange';

const seasons = [{ name: 'Season 1', episodes: 12, offset: 0 }, { name: 'Season 2', episodes: 10, offset: 12 }];

describe('episodeRange', () => {
	it('round-trips canonical form', () => {
		const s = 'S01E01-E12, S02E01-E03';
		expect(formatEpisodeRange(parseEpisodeRange(s)!)).toBe(s);
	});

	it('is tolerant', () => {
		expect(formatEpisodeRange(parseEpisodeRange('S1E1-S1E3,s02e05')!)).toBe('S01E01-E03, S02E05');
	});

	it('supports cross-season ranges when season sizes are known', () => {
		expect(formatEpisodeRange(parseEpisodeRange('S01E11-S02E02', seasons)!)).toBe('S01E11-E12, S02E01-E02');
		expect(parseEpisodeRange('S01E11-S02E02')).toBeNull();
	});

	it('returns [] for empty and null for garbage', () => {
		expect(parseEpisodeRange('')).toEqual([]);
		expect(parseEpisodeRange('1-12')).toBeNull();
	});

	it('converts to and from absolute numbers', () => {
		const refs = parseEpisodeRange('S01E12, S02E01')!;
		expect(toAbsolute(refs, seasons)).toEqual([12, 13]);
		expect(fromAbsolute([12, 13], seasons)).toEqual(refs);
	});

	it('rejects episode numbers above 10000 or beyond a known season', () => {
		expect(parseEpisodeRange('S01E10001')).toBeNull();
		expect(parseEpisodeRange('S01E01-E99999999')).toBeNull();
		expect(parseEpisodeRange('S01E10000')).toEqual([{ season: 1, episode: 10000 }]);
		expect(parseEpisodeRange('S01E13', seasons)).toBeNull();
		expect(parseEpisodeRange('S01E01-E13', seasons)).toBeNull();
		// a season the list does not know yet is not checked against a count
		expect(parseEpisodeRange('S03E40', seasons)).toEqual([{ season: 3, episode: 40 }]);
	});
});

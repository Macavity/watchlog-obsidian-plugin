import { describe, it, expect } from 'vitest';
import { decodeGame, encodeGame, parsePlaytime } from '../../src/storage/gameCodec';
import { formatTime } from '../../src/types';

describe('game codec', () => {
	it('parses playtime losslessly', () => {
		for (const m of [0, 45, 60, 125, 60 * 1234 + 5]) expect(parsePlaytime(formatTime(m))).toBe(m);
		expect(parsePlaytime('abc')).toBeNull();
		expect(parsePlaytime('')).toBeNull();
	});

	it('round-trips a game', () => {
		const fm = { title: 'Hades', status: 'Playing', progress: 40, playtime: '12h 30m', achievements: '10/49',
			platforms: ['PC'], externalId: 'rawg:274755', steamAppId: '1145360', lastPlayed: '2026-10-01T20:00:00Z',
			dateAdded: '2026-01-01T00:00:00Z', dateModified: '2026-01-01T00:00:00Z', type: 'game' };
		const { entry, invalidFields } = decodeGame('Games/Hades', fm);
		expect(invalidFields).toEqual([]);
		expect(entry).toMatchObject({ playtimeMinutes: 750, achievementsEarned: 10, achievementsTotal: 49, apiSource: 'rawg', apiId: '274755', lastPlayed: '2026-10-01T20:00:00Z' });
		expect(encodeGame(entry)).toMatchObject({ playtime: '12h 30m', achievements: '10/49', externalId: 'rawg:274755', steamAppId: '1145360', lastPlayed: '2026-10-01T20:00:00Z' });
	});

	it('keeps legacy keys, groups, airtime and igdb ids', () => {
		const fm = { title: 'G', developer: 'D', publisher: 'P', genre: 'RPG', status: 'Playing', priority: 'High', wishlist: true,
			externalId: 'igdb:1942', groups: ['A'], airtimeRecurrence: 'once', airtimeAcknowledged: '2026-10-01',
			coverUrl: 'c', storeUrl: 's', dateAdded: 'x', dateModified: 'y' };
		const { entry } = decodeGame('Games/G', fm);
		expect(entry).toMatchObject({ type: 'RPG', apiSource: 'igdb', apiId: '1942', wishlist: true, groups: ['A'] });
		expect(entry.airtime).toEqual({ recurrence: 'once', acknowledged: '2026-10-01' });
		expect(encodeGame(entry)).toMatchObject({ genre: 'RPG', developer: 'D', externalId: 'igdb:1942', storeUrl: 's', coverUrl: 'c', priority: 'High', wishlist: true, type: 'game' });
	});

	it('flags a bad playtime', () => {
		const { entry, invalidFields } = decodeGame('Games/B', { title: 'B', status: 'Playing', playtime: 'lots', dateAdded: 'x', dateModified: 'y' });
		expect(invalidFields).toContain('playtime');
		expect(entry.playtimeMinutes).toBe(0);
	});
});

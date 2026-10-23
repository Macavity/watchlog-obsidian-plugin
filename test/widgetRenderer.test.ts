import { describe, it, expect } from 'vitest';
import { findNextRelease, groupProgress } from '../src/WidgetRenderer';
import type { WatchLogTitle } from '../src/types';

const t = (id: string, watched: number[], over: Partial<WatchLogTitle> = {}): WatchLogTitle =>
	({ id, title: `T${id}`, type: 'Series', watchedEpisodes: watched, ...over }) as WatchLogTitle;

describe('groupProgress', () => {
	it('is 0 without episodes', () => {
		expect(groupProgress([], () => 0)).toBe(0);
		expect(groupProgress([t('a', [])], () => 0)).toBe(0);
	});
	it('rounds the watched share over all members', () => {
		expect(groupProgress([t('a', [1, 2]), t('b', [1])], () => 4)).toBe(38);
	});
	it('caps at 100', () => {
		expect(groupProgress([t('a', [1, 2, 3])], () => 2)).toBe(100);
	});
});

describe('findNextRelease', () => {
	const now = new Date('2030-01-10T00:00:00').getTime();
	const entry = (titleId: string, releaseDate: string | undefined, recurrence = 'once') =>
		({ titleId, schedule: { recurrence, releaseDate } }) as never;

	it('picks the soonest future one-off release', () => {
		const res = findNextRelease(
			[entry('a', '2030-03-01'), entry('b', '2030-01-12'), entry('c', '2029-12-01')],
			[t('a', []), t('b', []), t('c', [])],
			now,
		);
		expect(res).toEqual({ titleName: 'Tb', type: 'Series', releaseDate: '2030-01-12', daysUntil: 3 });
	});
	it('ignores recurring, undated and unknown-title entries', () => {
		expect(findNextRelease(
			[entry('a', '2030-02-01', 'weekly'), entry('b', undefined), entry('x', '2030-02-01')],
			[t('a', []), t('b', [])],
			now,
		)).toBeNull();
	});
});

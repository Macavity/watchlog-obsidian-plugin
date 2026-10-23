import { describe, it, expect, vi, afterEach } from 'vitest';
import { comparePriority, compareUnsetLast, isRecentlyReleased, pickRandom } from '../../src/ui/TabHelpers';

describe('pickRandom', () => {
	it('returns count distinct items from the pool without mutating it', () => {
		const pool = [1, 2, 3, 4, 5];
		const picks = pickRandom(pool, 3);
		expect(picks).toHaveLength(3);
		expect(new Set(picks).size).toBe(3);
		expect(picks.every((p) => pool.includes(p))).toBe(true);
		expect(pool).toEqual([1, 2, 3, 4, 5]);
	});

	it('returns the whole pool when count exceeds it, and [] for an empty pool', () => {
		expect(pickRandom([1, 2], 5).sort()).toEqual([1, 2]);
		expect(pickRandom([], 3)).toEqual([]);
	});

	it('is deterministic for a fixed random source', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
		expect(pickRandom([1, 2, 3], 3)).toEqual([2, 3, 1]);
		spy.mockRestore();
	});
});

describe('compareUnsetLast', () => {
	it('sorts unset (0) after every value in both directions', () => {
		expect([0, 3, 0, 5, 1].sort((a, b) => compareUnsetLast(a, b, 'asc'))).toEqual([1, 3, 5, 0, 0]);
		expect([0, 3, 0, 5, 1].sort((a, b) => compareUnsetLast(a, b, 'desc'))).toEqual([5, 3, 1, 0, 0]);
	});

	it('treats two unset values as equal', () => {
		expect(compareUnsetLast(0, 0, 'asc')).toBe(0);
		expect(compareUnsetLast(0, 0, 'desc')).toBe(0);
	});

	it('keeps half stars apart', () => {
		expect(compareUnsetLast(4.5, 4, 'desc')).toBeLessThan(0);
		expect(compareUnsetLast(4.5, 4, 'asc')).toBeGreaterThan(0);
	});
});

describe('comparePriority', () => {
	it('orders High, Medium, Low, then empty/unknown', () => {
		expect(['', 'Low', 'High', 'Other', 'Medium'].sort(comparePriority)).toEqual(['High', 'Medium', 'Low', '', 'Other']);
	});
});

describe('isRecentlyReleased', () => {
	afterEach(() => vi.useRealTimers());

	it('is true for today and up to 7 days back, false for older, future or malformed dates', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-06-15T12:00:00'));
		expect(isRecentlyReleased('2025-06-15')).toBe(true);
		expect(isRecentlyReleased('2025-06-08')).toBe(true);
		expect(isRecentlyReleased('2025-06-07')).toBe(false);
		expect(isRecentlyReleased('2025-06-16')).toBe(false);
		expect(isRecentlyReleased('2025-06')).toBe(false);
		expect(isRecentlyReleased(null)).toBe(false);
	});
});

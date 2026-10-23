import { describe, it, expect } from 'vitest';
import { parseHistoryLine, formatHistoryLine } from '../../src/storage/historyLine';

describe('historyLine', () => {
	it('round-trips a linked entry', () => {
		const l = '- 2026-10-17T11:02:10Z · watched · [[TV Show/Dark]] · S01E03 #watchlist';
		expect(formatHistoryLine(parseHistoryLine(l)!)).toBe(l);
	});

	it('round-trips a plain target', () => {
		const l = '- 2026-10-17T11:05:00Z · group-created · Marvel';
		expect(parseHistoryLine(l)).toMatchObject({ action: 'group-created', target: 'Marvel', isLink: false });
		expect(formatHistoryLine(parseHistoryLine(l)!)).toBe(l);
	});

	it('keeps titles with special chars', () => {
		const l = '- 2026-10-17T10:00:00Z · added · [[Movie/Léon: The Professional]]';
		expect(parseHistoryLine(l)?.target).toBe('Movie/Léon: The Professional');
	});

	it('rejects garbage', () => {
		expect(parseHistoryLine('random text')).toBeNull();
		expect(parseHistoryLine('- not-a-date · added · x')).toBeNull();
	});
});

describe('history store lines', () => {
  it('keeps a multi-line name on one line', async () => {
    const { historyKey } = await import('../../src/storage/HistoryStore');
    const key = historyKey({ timestamp: '2026-10-17T10:00:00Z', action: 'added', titleName: 'Evil\n- 2026-01-01T00:00:00Z · deleted · X', message: '', source: 'Watchlist' } as never);
    expect(key).toBe('2026-10-17T10:00:00Z|added|Evil - 2026-01-01T00:00:00Z · deleted · X');
  });
});

import { describe, it, expect } from 'vitest';
import { escapeCsvField, parseCSV, parseCsvDate } from '../src/csv/csvCore';

describe('parseCSV', () => {
	it('parses plain rows', () => {
		expect(parseCSV('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
	});

	it('keeps an embedded comma inside a quoted field', () => {
		expect(parseCSV('"a,b",c')).toEqual([['a,b', 'c']]);
	});

	it('keeps an embedded newline inside a quoted field', () => {
		expect(parseCSV('"a\nb",c\nd,e')).toEqual([['a\nb', 'c'], ['d', 'e']]);
	});

	it('unescapes doubled quotes', () => {
		expect(parseCSV('"say ""hi""",x')).toEqual([['say "hi"', 'x']]);
	});

	it('normalizes CRLF and lone CR', () => {
		expect(parseCSV('a,b\r\n1,2\r3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
	});

	it('drops trailing fully-empty rows', () => {
		expect(parseCSV('a,b\n1,2\n\n\n')).toEqual([['a', 'b'], ['1', '2']]);
	});
});

describe('escapeCsvField', () => {
	it('maps null and undefined to empty', () => {
		expect(escapeCsvField(null)).toBe('');
		expect(escapeCsvField(undefined)).toBe('');
	});

	it('stringifies numbers', () => {
		expect(escapeCsvField(42)).toBe('42');
	});

	it('leaves plain strings alone', () => {
		expect(escapeCsvField('plain')).toBe('plain');
	});

	it('quotes comma, quote and newline', () => {
		expect(escapeCsvField('a,b')).toBe('"a,b"');
		expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
		expect(escapeCsvField('a\nb')).toBe('"a\nb"');
	});
});

describe('parseCsvDate', () => {
	it.each([
		['2025-06-27', '2025-06-27'],
		['27/06/2025', '2025-06-27'],
		['06/27/2025', '2025-06-27'],
		['5/6/2025', '2025-06-05'],
		['27 Jun 2025', '2025-06-27'],
		['Jun 27, 2025', '2025-06-27'],
		['27.06.2025', '2025-06-27'],
		['27-06-2025', '2025-06-27'],
	])('parses %s', (raw, expected) => {
		expect(parseCsvDate(raw)).toBe(expected);
	});

	it('returns null for garbage and empty input', () => {
		expect(parseCsvDate('garbage')).toBeNull();
		expect(parseCsvDate('')).toBeNull();
		expect(parseCsvDate('   ')).toBeNull();
	});
});

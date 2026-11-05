import { describe, expect, it } from 'vitest';
import { TENRAI_BASE, parseJikanBase, resolveJikanBase } from '../src/jikanBase';

describe('resolveJikanBase', () => {
	it('defaults to Tenrai for empty or missing input', () => {
		expect(resolveJikanBase(undefined)).toBe(TENRAI_BASE);
		expect(resolveJikanBase('')).toBe(TENRAI_BASE);
		expect(resolveJikanBase('   ')).toBe(TENRAI_BASE);
	});
	it('keeps a valid https endpoint, trimmed and without trailing slashes', () => {
		expect(resolveJikanBase(' https://jikan.example.org/v4// ')).toBe('https://jikan.example.org/v4');
	});
	it('falls back to Tenrai for non-https or malformed input', () => {
		expect(resolveJikanBase('http://192.168.1.5:8080/v4')).toBe(TENRAI_BASE);
		expect(resolveJikanBase('javascript:alert(1)')).toBe(TENRAI_BASE);
		expect(resolveJikanBase('not a url')).toBe(TENRAI_BASE);
	});
	it('falls back to Tenrai when the address carries credentials, a query or a fragment', () => {
		expect(resolveJikanBase('https://u:p@jikan.example.org/v4')).toBe(TENRAI_BASE);
		expect(resolveJikanBase('https://jikan.example.org/v4?key=1')).toBe(TENRAI_BASE);
		expect(resolveJikanBase('https://jikan.example.org/v4#top')).toBe(TENRAI_BASE);
	});
});

describe('parseJikanBase', () => {
	it('returns the normalized endpoint, or empty for anything unusable', () => {
		expect(parseJikanBase(' https://jikan.example.org/v4/ ')).toBe('https://jikan.example.org/v4');
		expect(parseJikanBase('')).toBe('');
		expect(parseJikanBase('http://jikan.example.org')).toBe('');
		expect(parseJikanBase('https://jikan.example.org/v4?x=1')).toBe('');
	});
});

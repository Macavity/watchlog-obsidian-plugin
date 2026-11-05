import { describe, expect, it } from 'vitest';
import { JIKAN_PUBLIC_BASE, TENRAI_BASE, resolveJikanBase } from '../src/jikanBase';

describe('resolveJikanBase', () => {
	it('defaults to Tenrai for empty or missing input', () => {
		expect(resolveJikanBase(undefined)).toBe(TENRAI_BASE);
		expect(resolveJikanBase('')).toBe(TENRAI_BASE);
		expect(resolveJikanBase('   ')).toBe(TENRAI_BASE);
	});
	it('keeps a valid https endpoint, trimmed and without trailing slashes', () => {
		expect(resolveJikanBase(' https://jikan.example.org/v4// ')).toBe('https://jikan.example.org/v4');
		expect(resolveJikanBase(JIKAN_PUBLIC_BASE)).toBe('https://api.jikan.moe/v4');
	});
	it('falls back to Tenrai for non-https or malformed input', () => {
		expect(resolveJikanBase('http://192.168.1.5:8080/v4')).toBe(TENRAI_BASE);
		expect(resolveJikanBase('javascript:alert(1)')).toBe(TENRAI_BASE);
		expect(resolveJikanBase('not a url')).toBe(TENRAI_BASE);
	});
});

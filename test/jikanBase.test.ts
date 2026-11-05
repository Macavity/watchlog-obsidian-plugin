import { describe, expect, it } from 'vitest';
import { TENRAI_BASE, parseJikanBase, resolveJikanEndpoint } from '../src/jikanBase';

const base = (raw: string | undefined) => resolveJikanEndpoint({ jikanBaseUrl: raw }).base;

describe('resolveJikanEndpoint base', () => {
	it('defaults to Tenrai for empty or missing input', () => {
		expect(base(undefined)).toBe(TENRAI_BASE);
		expect(base('')).toBe(TENRAI_BASE);
		expect(base('   ')).toBe(TENRAI_BASE);
	});
	it('keeps a valid https endpoint, trimmed and without trailing slashes', () => {
		expect(base(' https://jikan.example.org/v4// ')).toBe('https://jikan.example.org/v4');
	});
	it('falls back to Tenrai for non-https or malformed input', () => {
		expect(base('http://192.168.1.5:8080/v4')).toBe(TENRAI_BASE);
		expect(base('javascript:alert(1)')).toBe(TENRAI_BASE);
		expect(base('not a url')).toBe(TENRAI_BASE);
	});
	it('falls back to Tenrai when the address carries credentials, a query or a fragment', () => {
		expect(base('https://u:p@jikan.example.org/v4')).toBe(TENRAI_BASE);
		expect(base('https://jikan.example.org/v4?key=1')).toBe(TENRAI_BASE);
		expect(base('https://jikan.example.org/v4#top')).toBe(TENRAI_BASE);
	});
});

describe('resolveJikanEndpoint basic auth', () => {
	const nas = 'https://nas.example.org/jikan/v4';
	it('sends a Basic header to a custom endpoint', () => {
		const ep = resolveJikanEndpoint({ jikanBaseUrl: nas, jikanUsername: 'alex', jikanPassword: 'pässwort' });
		expect(ep.base).toBe(nas);
		const token = ep.headers['Authorization']!.replace(/^Basic /, '');
		expect(new TextDecoder().decode(Uint8Array.from(atob(token), (c) => c.charCodeAt(0)))).toBe('alex:pässwort');
	});
	it('sends no header without credentials', () => {
		expect(resolveJikanEndpoint({ jikanBaseUrl: nas }).headers).toEqual({});
	});
	it('never sends credentials to the Tenrai fallback', () => {
		expect(resolveJikanEndpoint({ jikanBaseUrl: '', jikanUsername: 'a', jikanPassword: 'b' }).headers).toEqual({});
		expect(resolveJikanEndpoint({ jikanBaseUrl: 'http://nas', jikanUsername: 'a', jikanPassword: 'b' }).headers).toEqual({});
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

import { describe, expect, it } from 'vitest';
import { TENRAI_BASE, parseJikanEndpoint, resolveJikanEndpoint, withoutCredentials } from '../src/jikanBase';

const base = (raw: string | undefined) => resolveJikanEndpoint(raw).base;
const decode = (header: string) =>
	new TextDecoder().decode(Uint8Array.from(atob(header.replace(/^Basic /, '')), (c) => c.charCodeAt(0)));

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
	it('falls back to Tenrai when the address carries a query or a fragment', () => {
		expect(base('https://jikan.example.org/v4?key=1')).toBe(TENRAI_BASE);
		expect(base('https://jikan.example.org/v4#top')).toBe(TENRAI_BASE);
	});
});

describe('resolveJikanEndpoint basic auth', () => {
	it('moves credentials from the address into a Basic header', () => {
		const ep = resolveJikanEndpoint('https://alex:p%C3%A4ss%40wort@nas.example.org/jikan/v4/');
		expect(ep.base).toBe('https://nas.example.org/jikan/v4');
		expect(decode(ep.headers['Authorization']!)).toBe('alex:päss@wort');
	});
	it('takes a login that is not valid percent-encoding literally instead of failing', () => {
		const ep = resolveJikanEndpoint('https://alex:50%off@nas.example.org/v4');
		expect(ep.base).toBe('https://nas.example.org/v4');
		expect(decode(ep.headers['Authorization']!)).toBe('alex:50%off');
	});
	it('sends no header without credentials', () => {
		expect(resolveJikanEndpoint('https://nas.example.org/v4').headers).toEqual({});
	});
	it('never sends credentials to Tenrai', () => {
		expect(resolveJikanEndpoint('https://a:b@api.tenrai.org/v1')).toEqual({ base: TENRAI_BASE, headers: {} });
		expect(resolveJikanEndpoint('http://a:b@nas.example.org').headers).toEqual({});
	});
});

describe('parseJikanEndpoint', () => {
	it('returns null for anything unusable', () => {
		expect(parseJikanEndpoint('')).toBeNull();
		expect(parseJikanEndpoint('http://jikan.example.org')).toBeNull();
		expect(parseJikanEndpoint('https://jikan.example.org/v4?x=1')).toBeNull();
	});
});

describe('withoutCredentials', () => {
	it('strips the login from an address and leaves everything else alone', () => {
		expect(withoutCredentials('https://alex:secret@nas.example.org/v4')).toBe('https://nas.example.org/v4');
		expect(withoutCredentials('http://alex:secret@nas')).not.toContain('secret');
		expect(withoutCredentials('https://nas.example.org/v4')).toBe('https://nas.example.org/v4');
	});
	it('gives up on an address it cannot parse, so no login can slip through', () => {
		expect(withoutCredentials('https://alex:secret@')).toBeNull();
		expect(withoutCredentials('not a url')).toBeNull();
		expect(withoutCredentials('')).toBe('');
	});
});

/** Jikan-v4-compatible mirror of MyAnimeList data; the default since the public Jikan API shut down. */
export const TENRAI_BASE = 'https://api.tenrai.org/v1';

/** Where Jikan requests go, and the headers they carry (Basic auth for a protected own instance). */
export interface JikanEndpoint {
	base: string;
	headers: Record<string, string>;
}

interface JikanSettings {
	jikanBaseUrl?: string;
	jikanUsername?: string;
	jikanPassword?: string;
}

/**
 * The endpoint a user typed, trimmed and without trailing slashes; '' when it is not a plain https
 * base (credentials, query or fragment would break or leak the request URLs built from it).
 */
export function parseJikanBase(raw: string | undefined): string {
	const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
	let u: URL;
	try { u = new URL(trimmed); } catch { return ''; }
	if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return '';
	return trimmed;
}

/** The user's endpoint when usable, Tenrai otherwise; credentials only ever go to the user's own one. */
export function resolveJikanEndpoint(s: JikanSettings): JikanEndpoint {
	const custom = parseJikanBase(s.jikanBaseUrl);
	if (!custom || custom === TENRAI_BASE) return { base: TENRAI_BASE, headers: {} };
	const user = s.jikanUsername ?? '';
	const pass = s.jikanPassword ?? '';
	if (!user && !pass) return { base: custom, headers: {} };
	return { base: custom, headers: { Authorization: `Basic ${utf8Base64(`${user}:${pass}`)}` } };
}

function utf8Base64(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary);
}

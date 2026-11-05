/** Jikan-v4-compatible mirror of MyAnimeList data; the default since the public Jikan API shut down. */
export const TENRAI_BASE = 'https://api.tenrai.org/v1';

/** Where Jikan requests go, and the headers they carry (Basic auth for a protected own instance). */
export interface JikanEndpoint {
	base: string;
	headers: Record<string, string>;
}

/**
 * The endpoint a user typed, or null when it is not an https base. Credentials in the address
 * (`https://user:pass@host/v4`) become a Basic auth header; a query or fragment would break the
 * request URLs built from the base and is rejected.
 */
export function parseJikanEndpoint(raw: string | undefined): JikanEndpoint | null {
	let u: URL;
	try { u = new URL((raw ?? '').trim()); } catch { return null; }
	if (u.protocol !== 'https:' || u.search || u.hash) return null;
	const user = decodeURIComponent(u.username);
	const pass = decodeURIComponent(u.password);
	u.username = '';
	u.password = '';
	const base = u.toString().replace(/\/+$/, '');
	if (!user && !pass) return { base, headers: {} };
	return { base, headers: { Authorization: `Basic ${utf8Base64(`${user}:${pass}`)}` } };
}

/** The user's endpoint when usable, Tenrai otherwise; credentials never go to Tenrai. */
export function resolveJikanEndpoint(raw: string | undefined): JikanEndpoint {
	const custom = parseJikanEndpoint(raw);
	return custom && custom.base !== TENRAI_BASE ? custom : { base: TENRAI_BASE, headers: {} };
}

/** The address without user and password, for copies that leave the device (vault backups). */
export function withoutCredentials(raw: string): string {
	let u: URL;
	try { u = new URL(raw); } catch { return raw; }
	if (!u.username && !u.password) return raw;
	u.username = '';
	u.password = '';
	return u.toString();
}

function utf8Base64(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary);
}

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
	const user = decodeLogin(u.username);
	const pass = decodeLogin(u.password);
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

/**
 * The address without user and password, for copies that leave the device (vault backups);
 * null when it cannot be parsed, since a login could then not be removed reliably.
 */
export function withoutCredentials(raw: string): string | null {
	if (raw.trim() === '') return raw;
	let u: URL;
	try { u = new URL(raw); } catch { return null; }
	if (!u.username && !u.password) return raw;
	u.username = '';
	u.password = '';
	return u.toString();
}

/** A login typed with a bare '%' (`50%off`) is not percent-encoding; take it as written. */
function decodeLogin(part: string): string {
	try { return decodeURIComponent(part); } catch { return part; }
}

function utf8Base64(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary);
}

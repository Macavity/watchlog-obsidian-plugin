/** Jikan-v4-compatible mirror of MyAnimeList data; the default since the public Jikan API shut down. */
export const TENRAI_BASE = 'https://api.tenrai.org/v1';

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

/** The endpoint requests go to: the user's one when usable, Tenrai otherwise. */
export function resolveJikanBase(raw: string | undefined): string {
	return parseJikanBase(raw) || TENRAI_BASE;
}

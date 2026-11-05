import { httpsOrEmpty } from './httpsUrl';

/** Jikan-v4-compatible mirror of MyAnimeList data; the default since the public Jikan API shut down. */
export const TENRAI_BASE = 'https://api.tenrai.org/v1';
export const JIKAN_PUBLIC_BASE = 'https://api.jikan.moe/v4';

/** The endpoint a user typed, trimmed and without trailing slashes; anything not https falls back to Tenrai. */
export function resolveJikanBase(raw: string | undefined): string {
	const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
	return httpsOrEmpty(trimmed) || TENRAI_BASE;
}

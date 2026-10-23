import type { ExternalId, ExternalSource } from './storageTypes';

type Kind = NonNullable<ExternalId['kind']>;

/** Allowed kind per source; null = source takes no kind. */
const KINDS: Record<ExternalSource, readonly Kind[] | null> = {
	tmdb: ['movie', 'tv'],
	imdb: null,
	mal: ['anime', 'manga'],
	anilist: ['anime', 'manga'],
	gbooks: null,
	rawg: null,
	igdb: null,
};

const ID_RE = /^[\w-]+$/;

const SOURCES = Object.keys(KINDS) as ExternalSource[];
const isSource = (s: string): s is ExternalSource => (SOURCES as string[]).includes(s);

/** Parses `source:id` or `source:kind:id`; null if unknown source, missing kind, or bad id. */
export function parseExternalId(s: string): ExternalId | null {
	const parts = s.split(':');
	const [source, ...rest] = parts;
	if (!source || !isSource(source)) return null;
	const kinds = KINDS[source];
	if (kinds) {
		const [kind, id] = rest;
		if (rest.length !== 2 || !kind || !id || !kinds.includes(kind as Kind) || !ID_RE.test(id)) return null;
		return { source, kind: kind as Kind, id };
	}
	const [id] = rest;
	if (rest.length !== 1 || !id || !ID_RE.test(id)) return null;
	return { source, id };
}

export function formatExternalId(e: ExternalId): string {
	return e.kind ? `${e.source}:${e.kind}:${e.id}` : `${e.source}:${e.id}`;
}

/** Derives the identity from a pasted IMDb, TMDB, MyAnimeList or AniList URL. */
export function externalIdFromLink(url: string): ExternalId | null {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return null;
	}
	const host = u.hostname.replace(/^www\./, '');
	const [a, b] = u.pathname.split('/').filter(Boolean);
	if (!a || !b) return null;
	if (host === 'imdb.com' && a === 'title' && /^tt\d+$/.test(b)) return { source: 'imdb', id: b };
	if (host === 'themoviedb.org' && (a === 'movie' || a === 'tv')) {
		const id = /^(\d+)/.exec(b)?.[1];
		return id ? { source: 'tmdb', kind: a, id } : null;
	}
	if ((host === 'myanimelist.net' || host === 'anilist.co') && (a === 'anime' || a === 'manga') && /^\d+$/.test(b)) {
		return { source: host === 'myanimelist.net' ? 'mal' : 'anilist', kind: a, id: b };
	}
	return null;
}

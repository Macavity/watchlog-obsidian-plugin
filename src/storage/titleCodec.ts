import type { AirtimeRecurrence, EntryAirtime, Season, WatchLogTitle } from '../types';
import { getDisplayPoster, getDisplayTrailer, getTitleCredits } from '../types';
import type { Decoded, EntryCache, EpisodeRef, ExternalId } from './storageTypes';
import { formatEpisodeRange, fromAbsolute, parseEpisodeRange, toAbsolute } from './episodeRange';
import { externalIdFromLink, formatExternalId, parseExternalId } from './externalId';

const RECURRENCES: readonly AirtimeRecurrence[] = ['once', 'daily', 'weekly', 'monthly'];

/** Movie = a single "Movie" season, or no seasons and exactly one episode. */
function isMovie(seasons: Season[], totalEpisodes: number): boolean {
	if (seasons.length === 1) return seasons[0]?.name === 'Movie';
	return seasons.length === 0 && totalEpisodes === 1;
}

/** Parses "Name: N" lines (optional " (skip_spec)") into seasons; offsets are cumulative. */
function parseSeasonLines(lines: string[]): Season[] {
	const seasons: Season[] = [];
	let offset = 0;
	for (const line of lines) {
		const m = line.trim().match(/^(.+?):\s*(\d+)(?:\s*\(([^)]+)\))?/);
		if (!m || !m[1] || !m[2]) continue;
		const episodes = parseInt(m[2], 10);
		const skippedEpisodes = m[3] ? parseSkipSpec(m[3]) : [];
		seasons.push({ name: m[1].trim(), episodes, offset, skippedEpisodes });
		offset += episodes;
	}
	return seasons;
}

/** "5,8,33-37" -> [5, 8, 33..37] */
function parseSkipSpec(spec: string): number[] {
	const out: number[] = [];
	for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
		const bits = part.split('-');
		if (bits.length === 2) {
			const from = parseInt(bits[0] ?? '', 10);
			const to = parseInt(bits[1] ?? '', 10);
			if (!isNaN(from) && !isNaN(to) && from <= to) for (let i = from; i <= to; i++) out.push(i);
		} else if (bits.length === 1) {
			const n = parseInt(part, 10);
			if (!isNaN(n)) out.push(n);
		}
	}
	return [...new Set(out)].sort((x, y) => x - y);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Field reader that records unreadable values and falls back to a default. */
class Reader {
	invalid: string[] = [];
	constructor(private fm: Record<string, unknown>) {}

	private bad(key: string): undefined {
		this.invalid.push(key);
		return undefined;
	}

	str(key: string): string | undefined {
		const v = this.fm[key];
		if (v === undefined || v === null) return undefined;
		if (typeof v === 'string') return v;
		if (v instanceof Date) return v.toISOString();
		if (isNum(v)) return String(v);
		return this.bad(key);
	}

	num(key: string): number | undefined {
		const v = this.fm[key];
		if (v === undefined || v === null) return undefined;
		return isNum(v) ? v : this.bad(key);
	}

	bool(key: string): boolean | undefined {
		const v = this.fm[key];
		if (v === undefined || v === null) return undefined;
		return typeof v === 'boolean' ? v : this.bad(key);
	}

	list(key: string): string[] | undefined {
		const v = this.fm[key];
		if (v === undefined || v === null) return undefined;
		if (typeof v === 'string') return v.trim() ? [v] : [];
		if (Array.isArray(v) && v.every((x) => typeof x === 'string' || isNum(x))) return v.map(String);
		return this.bad(key);
	}

	/** nullable date string: null/absent -> null */
	date(key: string): string | null {
		return this.str(key) ?? null;
	}
}

const nonEmpty = <T>(v: T[] | undefined): T[] | undefined => (v && v.length > 0 ? v : undefined);

function identityOf(r: Reader, fm: Record<string, unknown>, link: string): ExternalId | null {
	const raw = typeof fm.externalId === 'string' ? fm.externalId : undefined;
	if (raw !== undefined) {
		const parsed = parseExternalId(raw.trim());
		if (parsed) return parsed;
		r.invalid.push('externalId');
	}
	return link ? externalIdFromLink(link) : null;
}

export function decodeTitle(id: string, fm: Record<string, unknown>, cache: EntryCache | undefined): Decoded<WatchLogTitle> {
	const r = new Reader(fm);
	const c = cache ?? {};
	const status = r.str('status') ?? 'Plan to watch';
	const externalLink = r.str('externalLink') ?? '';

	// seasons: note override wins over cache
	let seasons: Season[] = [];
	let seasonsOverride = false;
	const seasonLines = r.list('seasons');
	if (seasonLines && seasonLines.length > 0) {
		seasons = parseSeasonLines(seasonLines);
		seasonsOverride = seasons.length > 0;
		if (!seasonsOverride) r.invalid.push('seasons');
	}
	if (!seasonsOverride) seasons = (c.seasons ?? []).map((s) => ({ ...s, skippedEpisodes: [] }));

	const total = r.num('totalEpisodes') ?? seasons.reduce((n, s) => n + s.episodes, 0);
	const movie = isMovie(seasons, total);

	let watchedEpisodes: number[] = [];
	if (movie) {
		if (status === 'Completed') watchedEpisodes = [1];
	} else {
		const watchedText = r.str('watched');
		if (watchedText?.trim()) {
			const refs = parseEpisodeRange(watchedText, seasons);
			if (refs) watchedEpisodes = toAbsolute(refs, seasons);
			else r.invalid.push('watched');
		}
		const skippedText = r.str('skipped');
		if (skippedText?.trim()) {
			const refs = parseEpisodeRange(skippedText, seasons);
			if (!refs) r.invalid.push('skipped');
			else {
				for (const ref of refs) {
					const season = seasons[ref.season - 1];
					if (season) season.skippedEpisodes = [...(season.skippedEpisodes ?? []), ref.episode];
				}
			}
		}
	}

	const title: WatchLogTitle = {
		id,
		title: r.str('title') ?? id.split('/').pop() ?? id,
		type: r.str('type') ?? 'TV Show',
		status,
		priority: r.str('priority') ?? 'Medium',
		review: r.str('review') ?? '',
		rating: r.num('rating') ?? 0,
		notes: '',
		dateStarted: r.date('dateStarted'),
		dateFinished: r.date('dateFinished'),
		dateAdded: r.str('dateAdded') ?? '',
		dateModified: r.str('dateModified') ?? '',
		totalEpisodes: total,
		episodeDuration: r.num('episodeDuration') ?? 0,
		releaseDate: r.date('releaseDate'),
		externalLink,
		seasons,
		watchedEpisodes,
	};
	if (seasonsOverride) title.seasonsOverride = true;

	// cache fields
	if (c.posterUrl !== undefined) title.posterUrl = c.posterUrl;
	if (c.trailerUrl !== undefined) title.trailerUrl = c.trailerUrl;
	if (c.director) title.director = c.director;
	if (c.cast) title.cast = c.cast;
	if (c.studio) title.studio = c.studio;
	if (c.communityRating !== undefined) title.communityRating = c.communityRating;
	if (c.communityVotes !== undefined) title.communityVotes = c.communityVotes;
	if (c.communitySource !== undefined) title.communitySource = c.communitySource as WatchLogTitle['communitySource'];
	if (c.communityRatingLastFetched !== undefined) title.communityRatingLastFetched = c.communityRatingLastFetched;
	if (c.collectionId !== undefined) title.collectionId = c.collectionId;
	if (c.tmdbId !== undefined) title.tmdbId = c.tmdbId;
	if (c.tmdbMediaType !== undefined) title.tmdbMediaType = c.tmdbMediaType;
	if (c.malId !== undefined) title.malId = c.malId;
	if (c.anilistId !== undefined) title.anilistId = c.anilistId;

	// identity from externalId (fallback: link) wins over cached ids
	const ext = identityOf(r, fm, externalLink);
	if (ext) {
		const n = Number(ext.id);
		if (ext.source === 'tmdb' && ext.kind && !isNaN(n)) {
			title.tmdbId = n;
			title.tmdbMediaType = ext.kind === 'movie' ? 'movie' : 'tv';
		} else if (ext.source === 'mal' && !isNaN(n)) title.malId = n;
		else if (ext.source === 'anilist' && !isNaN(n)) title.anilistId = n;
		else if (ext.source === 'imdb' && !externalLink) title.externalLink = `https://www.imdb.com/title/${ext.id}`;
	}

	if (r.bool('pinned')) title.pinned = true;
	const favorite = r.bool('favorite');
	if (favorite !== undefined) title.favorite = favorite;
	const dateFavorited = r.str('dateFavorited');
	if (dateFavorited) title.dateFavorited = dateFavorited;
	if (r.bool('maybe')) title.maybe = true;
	const groups = nonEmpty(r.list('groups'));
	if (groups) title.groups = groups;

	// manual overrides and credits
	const manualPoster = r.str('manualPosterUrl');
	if (manualPoster) title.manualPosterUrl = manualPoster;
	const manualTrailer = r.str('manualTrailerUrl');
	if (manualTrailer) title.manualTrailerUrl = manualTrailer;
	const manualDirector = nonEmpty(r.list('manualDirector'));
	if (manualDirector) title.manualDirector = manualDirector;
	const manualCast = nonEmpty(r.list('manualCast'));
	if (manualCast) title.manualCast = manualCast;
	const manualStudio = nonEmpty(r.list('manualStudio'));
	if (manualStudio) title.manualStudio = manualStudio;

	// airtime
	const rec = r.str('airtimeRecurrence');
	if (rec !== undefined) {
		if ((RECURRENCES as string[]).includes(rec)) {
			const airtime: EntryAirtime = { recurrence: rec as AirtimeRecurrence };
			const day = r.num('airtimeDay');
			if (day !== undefined) airtime.day = day;
			const time = r.str('airtimeTime');
			if (time !== undefined) airtime.time = time;
			const season = r.num('airtimeSeason');
			if (season !== undefined) airtime.season = season;
			const episode = r.num('airtimeEpisode');
			if (episode !== undefined) airtime.episode = episode;
			const ack = r.str('airtimeAcknowledged');
			if (ack !== undefined) airtime.acknowledged = ack;
			title.airtime = airtime;
		} else r.invalid.push('airtimeRecurrence');
	}

	return { entry: title, invalidFields: [...new Set(r.invalid)] };
}

/** Primary identity for `externalId`: API ids first (anime prefers MAL/AniList), then the link. */
function identityFor(t: WatchLogTitle): ExternalId | null {
	const tmdb = (): ExternalId | null =>
		t.tmdbId !== undefined && t.tmdbMediaType ? { source: 'tmdb', kind: t.tmdbMediaType, id: String(t.tmdbId) } : null;
	const mal = (): ExternalId | null => (t.malId !== undefined ? { source: 'mal', kind: 'anime', id: String(t.malId) } : null);
	const anilist = (): ExternalId | null => (t.anilistId !== undefined ? { source: 'anilist', kind: 'anime', id: String(t.anilistId) } : null);
	const order = t.type === 'Anime' ? [mal, anilist, tmdb] : [tmdb, mal, anilist];
	for (const fn of order) {
		const id = fn();
		if (id) return id;
	}
	return t.externalLink ? externalIdFromLink(t.externalLink) : null;
}

/** Frontmatter fields for a title; keys keep the original plugin's names. `notes` is not included. */
export function encodeTitle(t: WatchLogTitle, progress: number): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	out.title = t.title;
	out.type = t.type;
	out.status = t.status;
	out.priority = t.priority;
	if (t.review) out.review = t.review;
	out.rating = t.rating;
	out.progress = `${progress}%`;
	out.totalEpisodes = t.totalEpisodes;
	out.episodeDuration = t.episodeDuration;
	out.dateStarted = t.dateStarted;
	out.dateFinished = t.dateFinished;
	out.dateAdded = t.dateAdded;
	out.dateModified = t.dateModified;
	if (t.releaseDate) out.releaseDate = t.releaseDate;
	if (t.malId !== undefined) out.malId = t.malId;
	if (t.anilistId !== undefined) out.anilistId = t.anilistId;
	if (t.communityRating !== undefined) out.communityRating = t.communityRating;
	if (t.communityVotes !== undefined) out.communityVotes = t.communityVotes;
	if (t.communitySource) out.communitySource = t.communitySource;
	// merged views, output-only
	for (const field of ['director', 'cast', 'studio'] as const) {
		const names = getTitleCredits(t, field);
		if (names.length > 0) out[field] = names;
	}
	const poster = getDisplayPoster(t);
	if (poster && poster !== 'none') out.poster = poster;
	const trailer = getDisplayTrailer(t);
	if (trailer) out.trailer = trailer;
	if (t.externalLink) out.externalLink = t.externalLink;
	if (t.pinned) out.pinned = true;
	if (t.favorite) out.favorite = true;
	if (t.dateFavorited) out.dateFavorited = t.dateFavorited;

	const ext = identityFor(t);
	if (ext) out.externalId = formatExternalId(ext);
	if (t.groups && t.groups.length > 0) out.groups = t.groups;
	if (t.maybe) out.maybe = true;

	// progress: movies are carried by status; without known seasons the note's text is left alone
	if (!isMovie(t.seasons, t.totalEpisodes) && t.seasons.length > 0) {
		out.watched = formatEpisodeRange(fromAbsolute(t.watchedEpisodes, t.seasons));
		const skipped: EpisodeRef[] = [];
		t.seasons.forEach((s, i) => {
			for (const episode of s.skippedEpisodes ?? []) skipped.push({ season: i + 1, episode });
		});
		if (skipped.length > 0) out.skipped = formatEpisodeRange(skipped);
	}
	if (t.seasonsOverride) out.seasons = t.seasons.map((s) => `${s.name}: ${s.episodes}`);

	if (t.manualPosterUrl) out.manualPosterUrl = t.manualPosterUrl;
	if (t.manualTrailerUrl) out.manualTrailerUrl = t.manualTrailerUrl;
	if (t.manualDirector?.length) out.manualDirector = t.manualDirector;
	if (t.manualCast?.length) out.manualCast = t.manualCast;
	if (t.manualStudio?.length) out.manualStudio = t.manualStudio;

	const a = t.airtime;
	if (a) {
		out.airtimeRecurrence = a.recurrence;
		if (a.day !== undefined) out.airtimeDay = a.day;
		if (a.time !== undefined) out.airtimeTime = a.time;
		if (a.season !== undefined) out.airtimeSeason = a.season;
		if (a.episode !== undefined) out.airtimeEpisode = a.episode;
		if (a.acknowledged !== undefined) out.airtimeAcknowledged = a.acknowledged;
	}
	return out;
}

/** API-derived fields that live in data.json; seasons only when not overridden in the note. */
export function splitCache(t: WatchLogTitle): EntryCache {
	const c: EntryCache = {};
	if (t.posterUrl !== undefined) c.posterUrl = t.posterUrl;
	if (t.trailerUrl !== undefined) c.trailerUrl = t.trailerUrl;
	if (t.director) c.director = t.director;
	if (t.cast) c.cast = t.cast;
	if (t.studio) c.studio = t.studio;
	if (t.communityRating !== undefined) c.communityRating = t.communityRating;
	if (t.communityVotes !== undefined) c.communityVotes = t.communityVotes;
	if (t.communitySource) c.communitySource = t.communitySource;
	if (t.communityRatingLastFetched !== undefined) c.communityRatingLastFetched = t.communityRatingLastFetched;
	if (t.collectionId !== undefined) c.collectionId = t.collectionId;
	if (t.tmdbId !== undefined) c.tmdbId = t.tmdbId;
	if (t.tmdbMediaType) c.tmdbMediaType = t.tmdbMediaType;
	if (t.malId !== undefined) c.malId = t.malId;
	if (t.anilistId !== undefined) c.anilistId = t.anilistId;
	if (!t.seasonsOverride && t.seasons.length > 0) {
		c.seasons = t.seasons.map((s) => ({ name: s.name, episodes: s.episodes, offset: s.offset }));
	}
	return c;
}

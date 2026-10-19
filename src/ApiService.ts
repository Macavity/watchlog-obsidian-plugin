import { requestUrl } from 'obsidian';
import { httpsOrEmpty } from './httpsUrl';
import type {
	AnimeSearchResult,
	MediaSearchResult,
	WatchLogTitle,
	JikanAnime,
	OmdbSearchItem,
	OmdbSearchResponse,
	OmdbDetailResponse,
	OmdbSeasonResponse,
	TmdbSearchItem,
	TmdbSearchResponse,
	TmdbMovieDetail,
	TmdbTvDetail,
	TmdbExternalIds,
	TmdbFindResult,
	TmdbVideo,
	TmdbCreditsResult,
	TmdbCollectionRef,
	TmdbCollectionDetail,
	TmdbCompany,
	Season,
	AniListMedia,
	AniListSearchResponse,
	AniListMediaResponse,
} from './types';
import { isCreditsNone, normalizeCreditsForStore, imdbIdFromLink } from './types';
import type { EntryCache } from './storage/storageTypes';

type Airing = NonNullable<EntryCache['airing']>;

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const OMDB_BASE = 'https://www.omdbapi.com';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const ANILIST_RATE_LIMIT_MS = 700;
const GOOGLE_BOOKS_BASE = 'https://www.googleapis.com/books/v1';
const RAWG_BASE = 'https://api.rawg.io/api';
const IGDB_BASE = 'https://api.igdb.com/v4';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const JIKAN_RATE_LIMIT_MS = 400;
const API_TIMEOUT_MS = 8000;

/** Add-flow search: 9 results per modal page, 3 pages. */
export const SEARCH_PAGE_SIZE = 9;
export const SEARCH_MAX_PAGES = 3;
export const SEARCH_RESULT_LIMIT = SEARCH_PAGE_SIZE * SEARCH_MAX_PAGES;
/** Fixed upstream page sizes; the fetch loops page until they reach the cap. */
const TMDB_PAGE_SIZE = 20;
const OMDB_PAGE_SIZE = 10;
const JIKAN_PAGE_SIZE = 25;

/** '' unless the input is a plain 4-digit year. Guards every provider's year filter. */
function nonEmptySeasons(seasons: Season[] | undefined): Season[] | null {
	return seasons && seasons.length > 0 ? seasons : null;
}

function searchYear(year: string | undefined): string {
	return year?.trim().match(/^\d{4}$/)?.[0] ?? '';
}

/** Canonical YouTube watch URL from a raw video id. */
function youtubeWatchUrl(id: string): string {
	return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * A YouTube video id from any shape providers hand back — `watch?v=ID`, `youtu.be/ID`
 * or `/embed/ID` (Jikan often ships only the embed URL). '' when none match.
 */
function extractYoutubeId(url: string | null | undefined): string {
	if (!url) return '';
	const m = url.match(/(?:[?&]v=|\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
	return m?.[1] ?? '';
}

/**
 * Splits an OMDb comma-separated name string ("Director" / "Actors") into a normalized
 * stored list: trimmed names, or ['none'] when absent / 'N/A', so both APIs yield the
 * same shape.
 */
function omdbNamesToCredits(s: string | undefined): string[] {
	if (!s || s === 'N/A') return normalizeCreditsForStore([]);
	return normalizeCreditsForStore(s.split(','));
}

/**
 * Director credits for an OMDb *series*: Director is 'N/A' there (it varies per episode),
 * so the creators — which OMDb puts in Writer — fill the stored director instead, with
 * role notes stripped. Falls back to Director, then to the 'none' sentinel.
 */
function omdbSeriesDirectorCredits(data: OmdbDetailResponse): string[] {
	const raw = !data.Writer || data.Writer === 'N/A' ? [] : data.Writer.split(',');
	const creators = normalizeCreditsForStore(raw.map((n) => n.replace(/\([^)]*\)/g, '')));
	return isCreditsNone(creators) ? omdbNamesToCredits(data.Director) : creators;
}

/**
 * Director credits for a TMDB *series*: `created_by` (series have no single director),
 * falling back to crew Director entries, then to the 'none' sentinel.
 */
function tmdbSeriesDirectorCredits(detail: TmdbTvDetail): string[] {
	const creators = normalizeCreditsForStore((detail.created_by ?? []).map((c) => c.name ?? ''));
	return isCreditsNone(creators) ? tmdbCreditsToStored(detail.credits).director : creators;
}

/**
 * Maps a TMDB `credits` payload to the stored { director, cast }: crew entries with the
 * Director job, plus the billing-ordered cast — normalized and capped like OMDb's.
 */
function tmdbCreditsToStored(credits: TmdbCreditsResult | undefined): { director: string[]; cast: string[] } {
	const director = (credits?.crew ?? [])
		.filter((c) => c.job === 'Director' && c.name)
		.map((c) => c.name!);
	const cast = (credits?.cast ?? []).map((c) => c.name ?? '');
	return {
		director: normalizeCreditsForStore(director),
		cast: normalizeCreditsForStore(cast),
	};
}

// 'none' = TMDB answered nothing there, 'error' = request failed. Only 'none' may be cached.
export type TmdbCollectionLookup =
	| { status: 'found'; ref: TmdbCollectionRef }
	| { status: 'none' }
	| { status: 'error' };

export type TmdbMovieIdLookup =
	| { status: 'found'; id: number }
	| { status: 'none' }
	| { status: 'error' };

/** TMDB company/network names, normalized for storage. */
function tmdbCompanyNames(list: TmdbCompany[] | undefined): string[] {
	return normalizeCreditsForStore((list ?? []).map((c) => c.name ?? ''));
}

/** One row in the Add-game search results (both RAWG and IGDB map to this). */
export interface GameSearchResult {
	source: 'rawg' | 'igdb';
	/** RAWG or IGDB numeric id — meaningful only with `source`. */
	id: number;
	title: string;
	/** YYYY-MM-DD, or '' when the API has no date. */
	releaseDate: string;
	coverUrl: string;
	platforms: string[];
	/** The game's page on the source site (rawg.io / igdb.com). */
	url: string;
}

/** Full detail payload for a selected game (the add-time autofill). */
export interface GameDetailsResult extends GameSearchResult {
	developer: string;
	publisher: string;
	singleplayer: boolean;
	coop: boolean;
	multiplayer: boolean;
	/** Store page URL, Steam → GOG → Epic priority; '' when none. */
	storeUrl: string;
}

// RAWG raw response shapes

interface RawgPlatformEntry {
	platform?: { name?: string };
}

interface RawgGame {
	id: number;
	slug?: string;
	name?: string;
	released?: string | null;
	background_image?: string | null;
	platforms?: RawgPlatformEntry[] | null;
}

interface RawgSearchResponse {
	results?: RawgGame[];
}

interface RawgGameDetail extends RawgGame {
	developers?: Array<{ name?: string }>;
	publishers?: Array<{ name?: string }>;
	tags?: Array<{ slug?: string; language?: string }>;
}

interface RawgStoresResponse {
	results?: Array<{ store_id?: number; url?: string }>;
}

// RAWG store ids (stable, documented): 1 Steam, 5 GOG, 11 Epic Games.
const RAWG_STORE_PRIORITY = [1, 5, 11];

// IGDB raw response shapes

interface IgdbGame {
	id: number;
	name?: string;
	first_release_date?: number;
	cover?: { image_id?: string };
	platforms?: Array<{ name?: string }>;
	game_modes?: Array<{ name?: string }>;
	involved_companies?: Array<{
		developer?: boolean;
		publisher?: boolean;
		company?: { name?: string };
	}>;
	websites?: Array<{ url?: string }>;
	url?: string;
}

interface TwitchTokenResponse {
	access_token?: string;
	expires_in?: number;
}

/** RAWG (english) tag slugs meaning co-op / versus multiplayer. */
const RAWG_COOP_TAGS = ['co-op', 'online-co-op', 'local-co-op', 'split-screen', 'cooperative'];
const RAWG_MULTIPLAYER_TAGS = ['multiplayer', 'online-multiplayer', 'massively-multiplayer', 'pvp'];

/** Store domains in pick order for the IGDB `websites` list (Steam → GOG → Epic). */
const IGDB_STORE_DOMAINS = ['store.steampowered.com', 'gog.com', 'epicgames.com'];

// Steam

const STEAM_API_BASE = 'https://api.steampowered.com';
const STEAM_STORE_BASE = 'https://store.steampowered.com/api';

/** Storefront category ids (stable): 2 Single-player, 1 Multi-player, 9/38/39 co-op. */
const STEAM_CAT_SINGLEPLAYER = 2;
const STEAM_CAT_MULTIPLAYER = 1;
const STEAM_COOP_CATS = new Set([9, 38, 39]);

/** Why a library fetch produced no games — drives the message the user sees. */
export type SteamFailureReason = 'ok' | 'missing' | 'badKey' | 'private' | 'empty' | 'network';

export interface SteamOwnedGame {
	appId: string;
	name: string;
	playtimeMinutes: number;
	/** ISO timestamp, or null when Steam reports no last-played time. */
	lastPlayed: string | null;
}

export interface SteamLibraryResult {
	ok: boolean;
	reason: SteamFailureReason;
	games: SteamOwnedGame[];
}

/** Storefront metadata, already mapped onto the plugin's own field names. */
export interface SteamAppDetails {
	name: string;
	developer: string;
	publisher: string;
	genres: string[];
	releaseDate: string | null;
	coverUrl: string;
	storeUrl: string;
	singleplayer: boolean;
	coop: boolean;
	multiplayer: boolean;
}

interface SteamVanityResponse {
	response?: { success?: number; steamid?: string };
}

interface SteamOwnedGamesResponse {
	response?: {
		game_count?: number;
		games?: Array<{
			appid: number;
			name?: string;
			playtime_forever?: number;
			rtime_last_played?: number;
		}>;
	};
}

interface SteamAchievementsResponse {
	playerstats?: {
		success?: boolean;
		achievements?: Array<{ achieved?: number }>;
	};
}

interface SteamAppDetailsEntry {
	success?: boolean;
	data?: {
		name?: string;
		developers?: string[];
		publishers?: string[];
		genres?: Array<{ description?: string }>;
		release_date?: { date?: string };
		categories?: Array<{ id: number; description?: string }>;
	};
}

/** IGDB co-op game_modes names (shared/local play, not versus). */
const IGDB_COOP_MODES = new Set([
	'Co-operative',
	'Split screen',
]);

/** IGDB multiplayer game_modes names (single player and co-op are their own). */
const IGDB_MULTIPLAYER_MODES = new Set([
	'Multiplayer',
	'Massively Multiplayer Online (MMO)',
	'Battle Royale',
]);

export interface BookSearchResult {
	title: string;
	author: string;
	year: number;
	totalPages: number;
	coverUrl: string;
	googleBooksId: string;
	releaseDate: string;
	url: string;
}

export interface MangaSearchResult {
	malId: number;
	title: string;
	author: string;
	year: number;
	totalChapters: number;
	totalVolumes: number;
	coverUrl: string;
	releaseDate: string;
	url: string;
}

interface GoogleVolumeInfo {
	title?: string;
	subtitle?: string;
	authors?: string[];
	publishedDate?: string;
	pageCount?: number;
	imageLinks?: {
		smallThumbnail?: string;
		thumbnail?: string;
		small?: string;
		medium?: string;
		large?: string;
		extraLarge?: string;
	};
	infoLink?: string;
	canonicalVolumeLink?: string;
}

interface GoogleVolume {
	id?: string;
	volumeInfo?: GoogleVolumeInfo;
}

interface GoogleBooksResponse {
	items?: GoogleVolume[];
}

interface JikanMangaItem {
	mal_id: number;
	title: string;
	title_english?: string | null;
	authors?: Array<{ name: string }>;
	chapters?: number | null;
	volumes?: number | null;
	published?: { from?: string | null } | null;
	images?: { jpg?: { image_url?: string | null; large_image_url?: string | null } | null } | null;
	url?: string | null;
}

/** Which service a failed request went to. */
export type ApiSource = 'tmdb' | 'omdb' | 'jikan' | 'anilist' | 'googleBooks' | 'rawg' | 'igdb' | 'twitch' | 'unknown';

/** Why it failed. 'no-key' = none set; 'auth' = the credential was rejected. */
export type ApiErrorReason =
	| 'no-key' | 'auth' | 'not-enabled' | 'rate-limited' | 'not-found' | 'server' | 'http' | 'parse' | 'network';

export class ApiError extends Error {
	source: ApiSource;
	reason: ApiErrorReason;
	status?: number;
	/** raw response body, for reasons that need it (OMDb packs its cause in a JSON field) */
	detail?: string;
	/** the service's own wording, when it sent one worth showing verbatim */
	providerMessage?: string;
	constructor(
		source: ApiSource,
		reason: ApiErrorReason,
		message: string,
		status?: number,
		detail?: string,
		providerMessage?: string,
	) {
		super(message);
		this.name = 'ApiError';
		this.source = source;
		this.reason = reason;
		this.status = status;
		this.detail = detail;
		this.providerMessage = providerMessage;
	}
}

/** Sources that take no credential, so "rejected your credentials" can never be the cause. */
const KEYLESS_SOURCES: ReadonlySet<ApiSource> = new Set<ApiSource>(['jikan', 'anilist']);

const API_LABELS: Record<ApiSource, string> = {
	tmdb: 'TMDB',
	omdb: 'OMDb',
	jikan: 'MyAnimeList (Jikan)',
	anilist: 'AniList',
	googleBooks: 'Google Books',
	rawg: 'RAWG',
	igdb: 'IGDB',
	twitch: 'Twitch',
	unknown: 'The API',
};

/** Source from the request URL — every base is a distinct host, so no call site has to say. */
export function apiSourceFromUrl(url: string): ApiSource {
	if (url.startsWith(TMDB_BASE)) return 'tmdb';
	if (url.startsWith(OMDB_BASE)) return 'omdb';
	if (url.startsWith(JIKAN_BASE)) return 'jikan';
	if (url.startsWith(ANILIST_ENDPOINT)) return 'anilist';
	if (url.startsWith(GOOGLE_BOOKS_BASE)) return 'googleBooks';
	if (url.startsWith(RAWG_BASE)) return 'rawg';
	if (url.startsWith(IGDB_BASE)) return 'igdb';
	if (url.startsWith(TWITCH_TOKEN_URL)) return 'twitch';
	return 'unknown';
}

/**
 * HTTP status → reason. Two services need the body as well: OMDb answers 401 for both a bad key
 * and an exhausted quota, and Google's 403 covers quota, a disabled API and a bad key alike.
 */
function classifyHttp(source: ApiSource, status: number, body: string): ApiErrorReason {
	// keyless service: a 403 is the service refusing to serve, never a bad credential.
	// AniList answers 403 with "the API has been temporarily disabled" during their outages.
	if (KEYLESS_SOURCES.has(source) && (status === 401 || status === 403)) return 'server';
	if (source === 'omdb' && (status === 401 || status === 403)) {
		return /limit/i.test(body) ? 'rate-limited' : 'auth';
	}
	if (source === 'googleBooks' && status === 403) {
		if (/accessNotConfigured/i.test(body)) return 'not-enabled';
		if (/rateLimitExceeded|dailyLimitExceeded|userRateLimitExceeded/i.test(body)) return 'rate-limited';
		return 'auth';
	}
	if (status === 401 || status === 403) return 'auth';
	if (status === 429) return 'rate-limited';
	if (status === 404) return 'not-found';
	if (status >= 500) return 'server';
	return 'http';
}

/**
 * The service's own explanation, when the body carries one: GraphQL `errors[0].message` (AniList,
 * on failed and 200 responses alike) or a top-level `message` (Jikan says which upstream broke).
 * '' when there is none.
 */
function providerMessageFrom(body: string): string {
	try {
		const data = JSON.parse(body) as { errors?: Array<{ message?: string }>; message?: unknown } | null;
		const gql = Array.isArray(data?.errors) ? (data.errors[0]?.message ?? '').trim() : '';
		if (gql) return gql;
		return typeof data?.message === 'string' ? data.message.trim() : '';
	} catch {
		return '';
	}
}

/** Maps any error from an API call to a short, user-facing explanation. */
export function apiErrorMessage(err: unknown): string {
	if (!(err instanceof ApiError)) return 'Request failed; check your connection.';
	const label = API_LABELS[err.source];

	// the service explained itself, and we have nothing better than a status code to offer.
	// only for the generic reasons: our own auth / quota / no-key wording names the actual fix,
	// which beats a terse provider string like Twitch's "invalid client".
	if (err.providerMessage && (err.reason === 'server' || err.reason === 'http')) {
		const text = err.providerMessage;
		return `${label}: ${/[.!?]$/.test(text) ? text : `${text}.`}`;
	}

	switch (err.reason) {
		case 'no-key':
			return err.source === 'tmdb'
				? 'TMDB token required; add one in Settings → API.'
				: `${label} API key required; add one in Settings → API.`;

		case 'auth':
			switch (err.source) {
				case 'tmdb':
					// the v3 key and the v4 token sit side by side on TMDB's own settings page
					return 'TMDB rejected this credential. Settings → API needs the API Read Access Token (v4), a long string starting "eyJ", not the 32-character v3 API key.';
				case 'omdb':
					return 'OMDb rejected the key. If it is new, click the activation link OMDb emailed you; keys do not work until activated.';
				case 'googleBooks':
					return 'Google rejected this key; check it was copied in full.';
				case 'rawg':
					return 'RAWG rejected the key; it may be invalid, or suspended for exceeding the monthly quota.';
				case 'twitch':
					return 'Twitch rejected the Client ID or Secret; re-check both in Settings → API → Games.';
				case 'igdb':
					return 'IGDB rejected the request; the credentials work, the query did not.';
				default:
					return `${label} rejected your credentials.`;
			}

		case 'not-enabled':
			return 'The Books API is not enabled for this key. Enable "Books API" in your Google Cloud project, then try again.';

		case 'rate-limited':
			switch (err.source) {
				case 'omdb':
					return 'OMDb daily request limit reached (1,000 per day on the free tier). It resets at midnight UTC.';
				case 'jikan':
					return 'MyAnimeList (Jikan) is rate-limiting requests; wait a few seconds and search again.';
				case 'anilist':
					return 'AniList is rate-limiting requests; wait a moment and search again.';
				case 'googleBooks':
					return 'Google Books quota exceeded for this key; it resets daily.';
				default:
					return `${label} is rate-limiting requests; wait a moment and try again.`;
			}

		case 'server':
			return KEYLESS_SOURCES.has(err.source)
				? `${label} is temporarily unavailable (HTTP ${err.status ?? '?'}). Try again shortly.`
				: `${label} is temporarily unavailable (HTTP ${err.status ?? '?'}). This is not your key; try again shortly.`;

		case 'not-found':
			return `${label} had no match for that request.`;

		case 'parse':
			return `${label} returned an unreadable response.`;

		case 'network':
			return `${label} is unreachable; check your connection.`;

		default:
			return `${label} request failed (HTTP ${err.status ?? '?'}).`;
	}
}

/** Chip-sized label for the same error — the full sentence goes in a detail line. */
export function apiErrorShort(err: unknown): string {
	if (!(err instanceof ApiError)) return 'Failed';
	switch (err.reason) {
		case 'no-key': return 'No key set';
		case 'auth': return 'Credential rejected';
		case 'not-enabled': return 'API not enabled';
		case 'rate-limited': return 'Rate limited';
		case 'server': return 'Service unavailable';
		case 'not-found': return 'Not found';
		case 'parse': return 'Unreadable response';
		case 'network': return 'Unreachable';
		default: return `Failed (HTTP ${err.status ?? '?'})`;
	}
}

/** True when the failure is a rejected credential — the one cause that must never read as "not found". */
export function isAuthFailure(err: unknown): boolean {
	return err instanceof ApiError && (err.reason === 'auth' || err.reason === 'not-enabled');
}

/** Status check + JSON parse for a throw:false response. Throws ApiError on either failure. */
export function readApiResponse(source: ApiSource, r: { status: number; text: string; json: unknown }): unknown {
	if (r.status < 200 || r.status >= 300) {
		throw new ApiError(
			source,
			classifyHttp(source, r.status, r.text),
			`${API_LABELS[source]} returned ${r.status}`,
			r.status,
			r.text,
			providerMessageFrom(r.text),
		);
	}
	try {
		return r.json;
	} catch {
		throw new ApiError(source, 'parse', `${API_LABELS[source]} returned a non-JSON body`);
	}
}

/**
 * OMDb can answer 200 with `{"Response":"False","Error":"Invalid API key!"}`. Only key and quota
 * problems are real errors here — "Movie not found!" is an ordinary empty result.
 */
function assertOmdbOk(data: { Response?: string; Error?: string }): void {
	if (data.Response !== 'False') return;
	const err = data.Error ?? '';
	if (/limit/i.test(err)) throw new ApiError('omdb', 'rate-limited', err, undefined, err);
	if (/key/i.test(err)) throw new ApiError('omdb', 'auth', err, undefined, err);
}

/**
 * Detail lookups keep their "null = not found" contract, but a rejected credential must never be
 * reported as a missing title — that is the failure users misdiagnose. Re-throw only those.
 */
function rethrowAuth(err: unknown): void {
	if (isAuthFailure(err)) throw err;
}

/** GraphQL reports failures in a 200 body — AniList rate limits arrive this way. */
function assertNoGraphqlErrors(source: ApiSource, data: unknown): void {
	const errors = (data as { errors?: Array<{ message?: string }> } | null)?.errors;
	if (!Array.isArray(errors) || errors.length === 0) return;
	const message = errors[0]?.message ?? 'Request rejected';
	const reason: ApiErrorReason = /rate limit|too many/i.test(message) ? 'rate-limited' : 'http';
	throw new ApiError(source, reason, message, undefined, undefined, message);
}

export class ApiService {
	private omdbApiKey: string;
	private tmdbApiKey: string;
	private googleBooksApiKey: string;
	private rawgApiKey: string;
	private igdbClientId: string;
	private igdbClientSecret: string;
	private steamApiKey = '';
	private steamId = '';
	/** Cached IGDB (Twitch) app access token + its absolute expiry timestamp. */
	private igdbToken = '';
	private igdbTokenExpiry = 0;
	private anilistLastRequest = 0;
	private anilistQueue: Promise<void> = Promise.resolve();
	private jikanLastRequest = 0;
	private jikanQueue: Promise<void> = Promise.resolve();

	private throttleJikan<T>(task: () => Promise<T>): Promise<T> {
		const run = async (): Promise<T> => {
			const now = Date.now();
			const gap = now - this.jikanLastRequest;
			if (gap < JIKAN_RATE_LIMIT_MS) {
				await new Promise<void>((r) => window.setTimeout(r, JIKAN_RATE_LIMIT_MS - gap));
			}
			this.jikanLastRequest = Date.now();
			return task();
		};
		const next = this.jikanQueue.then(run, run);
		this.jikanQueue = next.then(() => undefined, () => undefined);
		return next;
	}

	constructor(
		omdbApiKey: string,
		tmdbApiKey = '',
		googleBooksApiKey = '',
		rawgApiKey = '',
		igdbClientId = '',
		igdbClientSecret = '',
		steamApiKey = '',
		steamId = '',
	) {
		this.omdbApiKey = omdbApiKey;
		this.tmdbApiKey = tmdbApiKey;
		this.googleBooksApiKey = googleBooksApiKey;
		this.rawgApiKey = rawgApiKey;
		this.igdbClientId = igdbClientId;
		this.igdbClientSecret = igdbClientSecret;
		this.steamApiKey = steamApiKey;
		this.steamId = steamId;
	}

	setOmdbKey(key: string): void {
		this.omdbApiKey = key;
	}

	setTmdbKey(key: string): void {
		this.tmdbApiKey = key;
	}

	setGoogleBooksKey(key: string): void {
		this.googleBooksApiKey = key;
	}

	hasGoogleBooksKey(): boolean {
		return this.googleBooksApiKey.trim().length > 0;
	}

	setRawgKey(key: string): void {
		this.rawgApiKey = key;
	}

	setIgdbCredentials(clientId: string, clientSecret: string): void {
		// Invalidate the cached token whenever the credentials change.
		if (clientId !== this.igdbClientId || clientSecret !== this.igdbClientSecret) {
			this.igdbToken = '';
			this.igdbTokenExpiry = 0;
		}
		this.igdbClientId = clientId;
		this.igdbClientSecret = clientSecret;
	}

	hasRawgKey(): boolean {
		return this.rawgApiKey.trim().length > 0;
	}

	hasIgdbCredentials(): boolean {
		return this.igdbClientId.trim().length > 0 && this.igdbClientSecret.trim().length > 0;
	}

	private tmdbHeaders(): Record<string, string> {
		return { 'Authorization': `Bearer ${this.tmdbApiKey}` };
	}

	/**
	 * throw:false so the status survives — requestUrl's default collapses every 4xx into one
	 * opaque Error, which is why a rejected key used to look identical to "no results".
	 */
	private async fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<unknown> {
		const source = apiSourceFromUrl(url);
		let timer: number | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new ApiError(source, 'network', 'Request timed out')), API_TIMEOUT_MS);
		});
		try {
			const fetchPromise = requestUrl({ url, headers, throw: false }).then((r) => readApiResponse(source, r));
			return await Promise.race([fetchPromise, timeoutPromise]);
		} catch (err) {
			if (err instanceof ApiError) throw err;
			throw new ApiError(source, 'network', (err as Error)?.message ?? 'Network error');
		} finally {
			if (timer !== null) window.clearTimeout(timer);
		}
	}

	private async postJsonWithTimeout(
		url: string,
		body: unknown,
		headers?: Record<string, string>,
	): Promise<unknown> {
		const source = apiSourceFromUrl(url);
		let timer: number | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new ApiError(source, 'network', 'Request timed out')), API_TIMEOUT_MS);
		});
		try {
			const fetchPromise = requestUrl({
				url,
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
				body: JSON.stringify(body),
				throw: false,
			}).then((r) => {
				const data = readApiResponse(source, r);
				assertNoGraphqlErrors(source, data);
				return data;
			});
			return await Promise.race([fetchPromise, timeoutPromise]);
		} catch (err) {
			if (err instanceof ApiError) throw err;
			throw new ApiError(source, 'network', (err as Error)?.message ?? 'Network error');
		} finally {
			if (timer !== null) window.clearTimeout(timer);
		}
	}

	// AniList (GraphQL)

	/** Serializes AniList requests with a minimum gap of ANILIST_RATE_LIMIT_MS. */
	private throttleAniList<T>(task: () => Promise<T>): Promise<T> {
		const run = async (): Promise<T> => {
			const now = Date.now();
			const gap = now - this.anilistLastRequest;
			if (gap < ANILIST_RATE_LIMIT_MS) {
				await new Promise<void>((r) => window.setTimeout(r, ANILIST_RATE_LIMIT_MS - gap));
			}
			this.anilistLastRequest = Date.now();
			return task();
		};
		const next = this.anilistQueue.then(run, run);
		this.anilistQueue = next.then(() => undefined, () => undefined);
		return next;
	}

	private stripHtml(s: string): string {
		return s
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.trim();
	}

	private formatAniListDate(d: { year?: number | null; month?: number | null; day?: number | null } | null | undefined): string {
		if (!d?.year) return '';
		const yyyy = String(d.year);
		const mm = String(d.month ?? 1).padStart(2, '0');
		const dd = String(d.day ?? 1).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	}

	private mapAniListMedia(media: AniListMedia): AnimeSearchResult {
		const name = media.title?.english || media.title?.romaji || media.title?.native || '';
		const episodes = media.episodes ?? 0;
		const duration = media.duration ?? 24;
		const seasons: Season[] =
			episodes > 0 ? [{ name: 'Season 1', episodes, offset: 0 }] : [];
		const description = media.description ? this.stripHtml(media.description) : '';
		return {
			malId: 0,
			anilistId: media.id,
			title: name,
			episodes,
			duration,
			releaseDate: this.formatAniListDate(media.startDate),
			url: `https://anilist.co/anime/${media.id}`,
			seasons,
			description,
			averageScore: media.averageScore ?? undefined,
			genres: media.genres ?? undefined,
			posterUrl: httpsOrEmpty(media.coverImage?.large ?? media.coverImage?.medium) || undefined,
			trailerUrl:
				media.trailer?.site === 'youtube' && media.trailer.id
					? youtubeWatchUrl(media.trailer.id)
					: 'none',
		};
	}

	async searchAniList(query: string, year?: string): Promise<AnimeSearchResult[]> {
		// AniList rejects startDate_like: null, so the arg is only declared when a year is set
		const yr = searchYear(year);
		const gql = `
			query ($search: String${yr ? ', $year: String' : ''}) {
				Page(page: 1, perPage: ${SEARCH_RESULT_LIMIT}) {
					media(search: $search, type: ANIME${yr ? ', startDate_like: $year' : ''}) {
						id
						title { romaji english native }
						episodes
						duration
						status
						season
						seasonYear
						startDate { year month day }
						averageScore
						popularity
						coverImage { large medium }
						description
						genres
						trailer { id site }
					}
				}
			}
		`;
		const variables = yr ? { search: query, year: `${yr}%` } : { search: query };
		// throws ApiError — the caller renders the reason instead of an empty result list
		const res = await this.throttleAniList(() =>
			this.postJsonWithTimeout(ANILIST_ENDPOINT, { query: gql, variables }),
		);
		const data = res as AniListSearchResponse;
		const media = data.data?.Page?.media ?? [];
		return media.map((m) => this.mapAniListMedia(m));
	}

	async getAniListById(anilistId: number): Promise<AniListMedia | null> {
		const gql = `
			query ($id: Int) {
				Media(id: $id, type: ANIME) {
					id
					title { romaji english native }
					episodes
					duration
					status
					averageScore
					popularity
					coverImage { large }
					studios { edges { isMain node { name } } }
					trailer { id site }
					nextAiringEpisode {
						airingAt
						episode
						timeUntilAiring
					}
				}
			}
		`;
		try {
			const res = await this.throttleAniList(() =>
				this.postJsonWithTimeout(ANILIST_ENDPOINT, { query: gql, variables: { id: anilistId } }),
			);
			const data = res as AniListMediaResponse;
			return data.data?.Media ?? null;
		} catch {
			return null;
		}
	}

	// Jikan / MAL

	/**
	 * throws ApiError. `limit` defaults to one Jikan page; the add flow passes the full cap,
	 * which costs a second (throttled) request.
	 */
	async searchAnime(query: string, year?: string, limit = JIKAN_PAGE_SIZE): Promise<AnimeSearchResult[]> {
		// Jikan has no year param; a whole-year window is the equivalent
		const yr = searchYear(year);
		const base =
			`${JIKAN_BASE}/anime?q=${encodeURIComponent(query)}&limit=${JIKAN_PAGE_SIZE}&sfw=false` +
			(yr ? `&start_date=${yr}-01-01&end_date=${yr}-12-31` : '');
		const items: JikanAnime[] = [];
		const maxPages = Math.ceil(limit / JIKAN_PAGE_SIZE);
		for (let page = 1; page <= maxPages; page++) {
			const data = (await this.throttleJikan(() => this.fetchWithTimeout(`${base}&page=${page}`))) as {
				data?: JikanAnime[];
				pagination?: { has_next_page?: boolean };
			};
			items.push(...(data.data ?? []));
			if (items.length >= limit || !data.pagination?.has_next_page) break;
		}
		return items.slice(0, limit).map((a) => this.mapJikanAnime(a));
	}

	/** Resolves a Jikan `trailer` object to a YouTube URL, or 'none' when absent. */
	private jikanTrailerUrl(trailer: JikanAnime['trailer']): string {
		if (!trailer) return 'none';
		const id =
			(trailer.youtube_id ?? '') ||
			extractYoutubeId(trailer.url) ||
			extractYoutubeId(trailer.embed_url);
		return id ? youtubeWatchUrl(id) : 'none';
	}

	private mapJikanAnime(anime: JikanAnime): AnimeSearchResult {
		const durationStr = anime.duration ?? '24 min per ep';
		const durationMatch = durationStr.match(/(\d+)\s*min/);
		const duration = durationMatch && durationMatch[1] ? parseInt(durationMatch[1], 10) : 24;
		const episodes = anime.episodes ?? 0;
		const seasons: Season[] =
			episodes > 0 ? [{ name: 'Season 1', episodes, offset: 0 }] : [];
		return {
			malId: anime.mal_id,
			title: anime.title_english ?? anime.title,
			episodes,
			duration,
			releaseDate: anime.aired?.from ? (anime.aired.from.split('T')[0] ?? '') : '',
			url: httpsOrEmpty(anime.url),
			seasons,
			posterUrl: httpsOrEmpty(anime.images?.jpg?.large_image_url ?? anime.images?.jpg?.image_url ?? anime.images?.jpg?.small_image_url) || undefined,
			trailerUrl: this.jikanTrailerUrl(anime.trailer),
		};
	}

	// OMDb

	/** throws ApiError */
	async searchOmdb(query: string, type: 'movie' | 'series', year?: string): Promise<MediaSearchResult[]> {
		if (!this.omdbApiKey) throw new ApiError('omdb', 'no-key', 'OMDb API key not set');
		const yr = searchYear(year);
		const base =
			`${OMDB_BASE}/?s=${encodeURIComponent(query)}&type=${type}` +
			(yr ? `&y=${yr}` : '') +
			`&apikey=${encodeURIComponent(this.omdbApiKey)}`;
		const items: OmdbSearchItem[] = [];
		const maxPages = Math.ceil(SEARCH_RESULT_LIMIT / OMDB_PAGE_SIZE);
		for (let page = 1; page <= maxPages; page++) {
			const data = (await this.fetchWithTimeout(`${base}&page=${page}`)) as OmdbSearchResponse;
			assertOmdbOk(data);
			// past the last page OMDb answers Response:False, not an empty list
			if (data.Response === 'False') break;
			const batch = data.Search ?? [];
			items.push(...batch);
			const total = parseInt(data.totalResults ?? '', 10);
			if (items.length >= SEARCH_RESULT_LIMIT || batch.length < OMDB_PAGE_SIZE) break;
			if (Number.isFinite(total) && items.length >= total) break;
		}
		return items.slice(0, SEARCH_RESULT_LIMIT).map((item) => {
			// series Year is a range ("2008–2013", "2025–") — keep the start year only
			const startYear = item.Year?.match(/^(\d{4})/)?.[1];
			// year only. OMDb search has no day/month; a faked 01-01 reads like a real date
			return {
				imdbId: item.imdbID,
				title: item.Title,
				mediaType: type === 'movie' ? ('movie' as const) : ('tv' as const),
				// 0 like TMDB — the result card prints the media type instead of "1 eps".
				// The real count comes from the detail call on select.
				episodes: 0,
				episodeDuration: 0,
				releaseDate: startYear ?? '',
				url: `https://www.imdb.com/title/${item.imdbID}`,
				seasons: [],
				posterUrl: item.Poster !== 'N/A' ? httpsOrEmpty(item.Poster) || undefined : undefined,
			};
		});
	}

	async getOmdbMovieDetails(imdbId: string): Promise<MediaSearchResult | null> {
		if (!this.omdbApiKey) return null;
		const url = `${OMDB_BASE}/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(this.omdbApiKey)}`;
		try {
			const data = (await this.fetchWithTimeout(url)) as OmdbDetailResponse;
			assertOmdbOk(data);
			if (data.Response === 'False' || !data.imdbID) return null;
			const runtimeMin = data.Runtime ? parseInt(data.Runtime.replace(/[^0-9]/g, ''), 10) : 120;
			return {
				imdbId: data.imdbID,
				title: data.Title,
				mediaType: 'movie',
				episodes: 1,
				episodeDuration: isNaN(runtimeMin) ? 120 : runtimeMin,
				releaseDate: this.parseOmdbDate(data.Released ?? data.Year),
				url: `https://www.imdb.com/title/${data.imdbID}`,
				seasons: [{ name: 'Movie', episodes: 1, offset: 0 }],
				trailerUrl: 'none', // OMDb does not provide trailers.
				director: omdbNamesToCredits(data.Director),
				cast: omdbNamesToCredits(data.Actors),
			};
		} catch (e) {
			rethrowAuth(e);
			return null;
		}
	}

	async getOmdbTvDetails(imdbId: string): Promise<MediaSearchResult | null> {
		if (!this.omdbApiKey) return null;
		const url = `${OMDB_BASE}/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(this.omdbApiKey)}`;
		try {
			const data = (await this.fetchWithTimeout(url)) as OmdbDetailResponse;
			assertOmdbOk(data);
			if (data.Response === 'False' || !data.imdbID) return null;

			const totalSeasons = parseInt(data.totalSeasons ?? '1', 10) || 1;
			const seasons: Season[] = [];
			let offset = 0;

			for (let s = 1; s <= totalSeasons; s++) {
				const count = await this.getOmdbSeasonEpisodeCount(imdbId, s);
				if (count === null) break;
				seasons.push({ name: `Season ${s}`, episodes: count, offset });
				offset += count;
			}

			const totalEpisodes = seasons.reduce((sum, s) => sum + s.episodes, 0);
			return {
				imdbId: data.imdbID,
				title: data.Title,
				mediaType: 'tv',
				episodes: totalEpisodes,
				episodeDuration: 45,
				releaseDate: this.parseOmdbDate(data.Released ?? data.Year),
				url: `https://www.imdb.com/title/${data.imdbID}`,
				seasons,
				trailerUrl: 'none', // OMDb does not provide trailers.
				director: omdbSeriesDirectorCredits(data),
				cast: omdbNamesToCredits(data.Actors),
			};
		} catch (e) {
			rethrowAuth(e);
			return null;
		}
	}

	private async getOmdbSeasonEpisodeCount(imdbId: string, season: number): Promise<number | null> {
		const url = `${OMDB_BASE}/?i=${encodeURIComponent(imdbId)}&Season=${season}&apikey=${encodeURIComponent(this.omdbApiKey)}`;
		try {
			const data = (await this.fetchWithTimeout(url)) as OmdbSeasonResponse;
			if (data.Response === 'False') return null;
			return (data.Episodes ?? []).length;
		} catch {
			return null;
		}
	}

	// Jikan schedule

	async getAnimeScheduleByMalId(
		malId: number,
	): Promise<{ dayOfWeek: number; time: string } | null> {
		try {
			const url = `${JIKAN_BASE}/anime/${malId}`;
			const data = (await this.fetchWithTimeout(url)) as {
				data?: { broadcast?: { day?: string | null; time?: string | null } };
			};
			const broadcast = data.data?.broadcast;
			if (!broadcast?.day || !broadcast.time) return null;

			const dayMap: Record<string, number> = {
				Mondays: 1, Tuesdays: 2, Wednesdays: 3, Thursdays: 4,
				Fridays: 5, Saturdays: 6, Sundays: 0,
			};
			const dayOfWeek = dayMap[broadcast.day];
			if (dayOfWeek === undefined) return null;
			return { dayOfWeek, time: broadcast.time };
		} catch {
			return null;
		}
	}

	/** Trailer lookup for one anime (Jikan /anime/{mal_id}). Returns a URL or 'none'. */
	async getJikanTrailerByMalId(malId: number): Promise<string> {
		try {
			const url = `${JIKAN_BASE}/anime/${malId}`;
			const data = (await this.throttleJikan(() => this.fetchWithTimeout(url))) as { data?: JikanAnime };
			return this.jikanTrailerUrl(data.data?.trailer);
		} catch {
			return 'none';
		}
	}

	/**
	 * OMDb "DD Mon YYYY" (e.g. "08 Feb 2026") → YYYY-MM-DD. Returns the input unchanged
	 * when it doesn't match that pattern (e.g. year-only "2026").
	 */
	private parseOmdbDate(dateStr: string): string {
		const MONTHS: Record<string, string> = {
			Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
			Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
		};
		const m = dateStr.match(/^(\d{2})\s+([A-Za-z]{3})\s+(\d{4})$/);
		if (m && m[1] && m[2] && m[3]) {
			const mon = MONTHS[m[2]];
			if (mon) return `${m[3]}-${mon}-${m[1]}`;
		}
		return dateStr;
	}

	/** Fetches OMDb detail by raw IMDb ID, auto-detecting movie vs. TV. */
	async getOmdbByImdbId(imdbId: string): Promise<MediaSearchResult | null> {
		if (!this.omdbApiKey) return null;
		const url = `${OMDB_BASE}/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(this.omdbApiKey)}`;
		try {
			const data = (await this.fetchWithTimeout(url)) as OmdbDetailResponse;
			assertOmdbOk(data);
			if (data.Response === 'False' || !data.imdbID) return null;
			if (data.Type === 'movie') return this.getOmdbMovieDetails(imdbId);
			return this.getOmdbTvDetails(imdbId);
		} catch (e) {
			rethrowAuth(e);
			return null;
		}
	}

	// TMDB

	/** throws ApiError */
	async searchTmdb(query: string, type: 'movie' | 'series', year?: string): Promise<MediaSearchResult[]> {
		if (!this.tmdbApiKey) throw new ApiError('tmdb', 'no-key', 'TMDB token not set');
		const endpoint = type === 'movie' ? 'movie' : 'tv';
		// TMDB matches `query` literally; a year typed into it ("Bachelor 2021") finds nothing
		const yr = searchYear(year);
		const yearKey = type === 'movie' ? 'primary_release_year' : 'first_air_date_year';
		const base =
			`${TMDB_BASE}/search/${endpoint}?query=${encodeURIComponent(query)}` +
			(yr ? `&${yearKey}=${yr}` : '');
		const items: TmdbSearchItem[] = [];
		const maxPages = Math.ceil(SEARCH_RESULT_LIMIT / TMDB_PAGE_SIZE);
		for (let page = 1; page <= maxPages; page++) {
			const data = (await this.fetchWithTimeout(`${base}&page=${page}`, this.tmdbHeaders())) as TmdbSearchResponse;
			items.push(...(data.results ?? []));
			if (items.length >= SEARCH_RESULT_LIMIT || page >= (data.total_pages ?? 1)) break;
		}
		return items.slice(0, SEARCH_RESULT_LIMIT).map((item) => ({
			imdbId: String(item.id),
			title: item.title ?? item.name ?? '',
			mediaType: type === 'movie' ? ('movie' as const) : ('tv' as const),
			episodes: 0,
			episodeDuration: 0,
			releaseDate: item.release_date ?? item.first_air_date ?? '',
			url: '',
			seasons: [],
			posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : undefined,
		}));
	}

	/**
	 * Best trailer from a TMDB `videos.results`: an official YouTube Trailer first, then any
	 * YouTube Trailer, then any Teaser. Returns a watch URL, or 'none'.
	 */
	private pickTmdbTrailer(videos: TmdbVideo[] | undefined): string {
		const yt = (videos ?? []).filter((v) => v.site === 'YouTube' && v.key);
		const pick =
			yt.find((v) => v.type === 'Trailer' && v.official === true) ??
			yt.find((v) => v.type === 'Trailer') ??
			yt.find((v) => v.type === 'Teaser');
		return pick ? youtubeWatchUrl(pick.key) : 'none';
	}

	async getTmdbMovieDetails(tmdbId: string): Promise<MediaSearchResult | null> {
		if (!this.tmdbApiKey) return null;
		try {
			// append_to_response=videos,credits folds the trailer + credits lookups into the detail
			// call (no extra round-trips)
			const [detailData, extData] = await Promise.all([
				this.fetchWithTimeout(`${TMDB_BASE}/movie/${tmdbId}?append_to_response=videos,credits`, this.tmdbHeaders()),
				this.fetchWithTimeout(`${TMDB_BASE}/movie/${tmdbId}/external_ids`, this.tmdbHeaders()),
			]);
			const detail = detailData as TmdbMovieDetail;
			const ext = extData as TmdbExternalIds;
			const imdbId = ext.imdb_id ?? detail.imdb_id ?? '';
			return {
				imdbId: String(detail.id),
				title: detail.title,
				mediaType: 'movie',
				episodes: 1,
				episodeDuration: detail.runtime ?? 120,
				releaseDate: detail.release_date ?? '',
				url: imdbId ? `https://www.imdb.com/title/${imdbId}` : '',
				seasons: [{ name: 'Movie', episodes: 1, offset: 0 }],
				trailerUrl: this.pickTmdbTrailer(detail.videos?.results),
				studio: tmdbCompanyNames(detail.production_companies),
				...tmdbCreditsToStored(detail.credits),
			};
		} catch (e) {
			rethrowAuth(e);
			return null;
		}
	}

	async getTmdbTvDetails(tmdbId: string): Promise<MediaSearchResult | null> {
		if (!this.tmdbApiKey) return null;
		try {
			const [detailData, extData] = await Promise.all([
				this.fetchWithTimeout(`${TMDB_BASE}/tv/${tmdbId}?append_to_response=videos,credits`, this.tmdbHeaders()),
				this.fetchWithTimeout(`${TMDB_BASE}/tv/${tmdbId}/external_ids`, this.tmdbHeaders()),
			]);
			const detail = detailData as TmdbTvDetail;
			const ext = extData as TmdbExternalIds;
			const imdbId = ext.imdb_id ?? '';

			const rawSeasons = (detail.seasons ?? []).filter((s) => s.season_number !== 0);
			let offset = 0;
			const seasons: Season[] = rawSeasons.map((s) => {
				const season: Season = { name: s.name, episodes: s.episode_count, offset };
				offset += s.episode_count;
				return season;
			});
			const totalEpisodes = seasons.reduce((sum, s) => sum + s.episodes, 0) || (detail.number_of_episodes ?? 0);

			return {
				imdbId: String(detail.id),
				title: detail.name,
				mediaType: 'tv',
				episodes: totalEpisodes,
				episodeDuration: (detail.episode_run_time ?? [])[0] ?? 45,
				releaseDate: detail.first_air_date ?? '',
				url: imdbId ? `https://www.imdb.com/title/${imdbId}` : '',
				seasons,
				trailerUrl: this.pickTmdbTrailer(detail.videos?.results),
				// networks lead — HBO/Netflix is the brand; production_companies is shells
				studio: tmdbCompanyNames([...(detail.networks ?? []), ...(detail.production_companies ?? [])]),
				director: tmdbSeriesDirectorCredits(detail),
				cast: tmdbCreditsToStored(detail.credits).cast,
			};
		} catch (e) {
			rethrowAuth(e);
			return null;
		}
	}

	// Season refill (a note from another device, no cached seasons)

	/**
	 * Season list by identity, from the same sources the add flow uses: AniList/Jikan episode count
	 * (one season), TMDB tv details, or OMDb/TMDB for an IMDb link. null = movie, no source, no
	 * seasons or the request failed.
	 */
	async fetchSeasons(
		title: Pick<WatchLogTitle, 'anilistId' | 'malId' | 'tmdbId' | 'tmdbMediaType' | 'externalLink'>,
	): Promise<Season[] | null> {
		const single = (episodes: number | null | undefined): Season[] | null =>
			episodes ? [{ name: 'Season 1', episodes, offset: 0 }] : null;
		try {
			if (title.anilistId !== undefined) return single((await this.getAniListById(title.anilistId))?.episodes);
			if (title.malId !== undefined) {
				const url = `${JIKAN_BASE}/anime/${title.malId}`;
				const data = (await this.throttleJikan(() => this.fetchWithTimeout(url))) as { data?: JikanAnime };
				return single(data.data?.episodes);
			}
			if (title.tmdbId !== undefined) {
				if (title.tmdbMediaType !== 'tv') return null;
				return nonEmptySeasons((await this.getTmdbTvDetails(String(title.tmdbId)))?.seasons);
			}
			const imdbId = imdbIdFromLink(title.externalLink);
			if (!imdbId) return null;
			const full = this.omdbApiKey ? await this.getOmdbTvDetails(imdbId) : await this.getTmdbByImdbId(imdbId);
			return full?.mediaType === 'tv' ? nonEmptySeasons(full.seasons) : null;
		} catch {
			return null;
		}
	}

	// Airing pointer (Upcoming)

	/**
	 * Next / last aired episode: AniList by `anilistId`, else TMDB tv by `tmdbId` (needs the key).
	 * null = no source or the request failed; nothing is fetched without an id.
	 */
	async fetchAiring(title: Pick<WatchLogTitle, 'anilistId' | 'tmdbId' | 'tmdbMediaType'>): Promise<Airing | null> {
		if (title.anilistId !== undefined) return this.fetchAniListAiring(title.anilistId);
		if (title.tmdbId !== undefined && title.tmdbMediaType === 'tv' && this.tmdbApiKey) {
			return this.fetchTmdbAiring(title.tmdbId);
		}
		return null;
	}

	private async fetchAniListAiring(anilistId: number): Promise<Airing | null> {
		const media = await this.getAniListById(anilistId);
		if (!media) return null;
		const airing: Airing = { refreshedAt: new Date().toISOString() };
		const next = media.nextAiringEpisode;
		if (typeof next?.episode === 'number') {
			airing.nextEpisode = next.episode;
			if (typeof next.airingAt === 'number') airing.nextAirDate = new Date(next.airingAt * 1000).toISOString();
			if (next.episode > 1) airing.lastEpisode = next.episode - 1;
		} else if (media.status === 'FINISHED' && typeof media.episodes === 'number' && media.episodes > 0) {
			airing.lastEpisode = media.episodes;
		}
		return airing;
	}

	private async fetchTmdbAiring(tmdbId: number): Promise<Airing | null> {
		try {
			const detail = await this.fetchWithTimeout(`${TMDB_BASE}/tv/${tmdbId}`, this.tmdbHeaders()) as TmdbTvDetail;
			const airing: Airing = { refreshedAt: new Date().toISOString() };
			const next = detail.next_episode_to_air;
			if (typeof next?.episode_number === 'number') {
				airing.nextEpisode = next.episode_number;
				if (typeof next.season_number === 'number') airing.nextSeason = next.season_number;
				if (next.air_date) airing.nextAirDate = next.air_date;
			}
			const last = detail.last_episode_to_air;
			if (typeof last?.episode_number === 'number') {
				airing.lastEpisode = last.episode_number;
				if (typeof last.season_number === 'number') airing.lastSeason = last.season_number;
			}
			return airing;
		} catch {
			return null;
		}
	}

	hasTmdbKey(): boolean {
		return this.tmdbApiKey.trim().length > 0;
	}

	// Studio / network

	/**
	 * Studio names for a title, plus the TMDB id it resolved through so the caller can cache it.
	 * null = couldn't reach a source (never store that); ['none'] = source has none.
	 *
	 * OMDb is not a source — its Production field returns 'N/A' on movies and is absent on
	 * series, verified 2026-07-28.
	 */
	async fetchStudio(
		title: WatchLogTitle,
		animeSource: 'jikan' | 'anilist',
		group: 'anime' | 'movie' | '',
	): Promise<{ studio: string[]; tmdbId?: number; tmdbMediaType?: 'movie' | 'tv' } | null> {
		if (group === 'anime') {
			const studio = await this.fetchAnimeStudio(title, animeSource);
			return studio ? { studio } : null;
		}
		if (group !== 'movie' || !this.tmdbApiKey) return null;
		return this.fetchTmdbStudio(title);
	}

	private async fetchAnimeStudio(
		title: WatchLogTitle,
		animeSource: 'jikan' | 'anilist',
	): Promise<string[] | null> {
		// follow the stored id, whichever it is — the preferred source may have no id here
		if (animeSource === 'anilist' && title.anilistId) {
			const media = await this.getAniListById(title.anilistId);
			if (!media) return null;
			const main = (media.studios?.edges ?? [])
				.filter((e) => e?.isMain)
				.map((e) => e?.node?.name ?? '');
			return normalizeCreditsForStore(main);
		}
		if (title.malId) {
			try {
				const url = `${JIKAN_BASE}/anime/${title.malId}`;
				const res = (await this.throttleJikan(() => this.fetchWithTimeout(url))) as {
					data?: JikanAnime;
				};
				const studios = res.data?.studios;
				if (!studios) return null;
				return normalizeCreditsForStore(studios.map((st) => st?.name ?? ''));
			} catch {
				return null;
			}
		}
		// preference was Jikan but only an AniList id exists — use what we have
		if (title.anilistId) {
			const media = await this.getAniListById(title.anilistId);
			if (!media) return null;
			return normalizeCreditsForStore(
				(media.studios?.edges ?? []).filter((e) => e?.isMain).map((e) => e?.node?.name ?? ''),
			);
		}
		return null;
	}

	private async fetchTmdbStudio(
		title: WatchLogTitle,
	): Promise<{ studio: string[]; tmdbId?: number; tmdbMediaType?: 'movie' | 'tv' } | null> {
		// a cached id skips the /find round-trip entirely
		if (title.tmdbId && title.tmdbMediaType) {
			const detail =
				title.tmdbMediaType === 'movie'
					? await this.getTmdbMovieDetails(String(title.tmdbId))
					: await this.getTmdbTvDetails(String(title.tmdbId));
			return detail?.studio ? { studio: detail.studio } : null;
		}

		const imdbId = imdbIdFromLink(title.externalLink);
		if (!imdbId) return null;
		try {
			const url = `${TMDB_BASE}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`;
			const found = (await this.fetchWithTimeout(url, this.tmdbHeaders())) as TmdbFindResult;
			const movieId = found.movie_results?.[0]?.id;
			if (movieId) {
				const detail = await this.getTmdbMovieDetails(String(movieId));
				if (!detail?.studio) return null;
				return { studio: detail.studio, tmdbId: movieId, tmdbMediaType: 'movie' };
			}
			const tvId = found.tv_results?.[0]?.id;
			if (tvId) {
				const detail = await this.getTmdbTvDetails(String(tvId));
				if (!detail?.studio) return null;
				return { studio: detail.studio, tmdbId: tvId, tmdbMediaType: 'tv' };
			}
			return null;
		} catch {
			return null;
		}
	}

	// TMDB collections. Movies only.

	/** exact key, so empty movie_results = definitively not a movie (all TV lands here) */
	async findTmdbMovieIdByImdbId(imdbId: string): Promise<TmdbMovieIdLookup> {
		if (!this.tmdbApiKey || !imdbId) return { status: 'error' };
		const url = `${TMDB_BASE}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`;
		try {
			const data = (await this.fetchWithTimeout(url, this.tmdbHeaders())) as TmdbFindResult;
			const id = data.movie_results?.[0]?.id;
			return id ? { status: 'found', id } : { status: 'none' };
		} catch {
			return { status: 'error' };
		}
	}

	/** fallback for manually-added titles with no IMDb link. Top result — can miss. */
	async searchTmdbMovieId(title: string, year?: string): Promise<number | null> {
		if (!this.tmdbApiKey || !title.trim()) return null;
		const yearParam = year?.match(/^(\d{4})/)?.[1];
		const url =
			`${TMDB_BASE}/search/movie?query=${encodeURIComponent(title)}&page=1` +
			(yearParam ? `&primary_release_year=${yearParam}` : '');
		try {
			const data = (await this.fetchWithTimeout(url, this.tmdbHeaders())) as TmdbSearchResponse;
			return data.results?.[0]?.id ?? null;
		} catch {
			return null;
		}
	}

	async getTmdbMovieCollection(tmdbId: number): Promise<TmdbCollectionLookup> {
		if (!this.tmdbApiKey) return { status: 'error' };
		try {
			const detail = (await this.fetchWithTimeout(
				`${TMDB_BASE}/movie/${tmdbId}`,
				this.tmdbHeaders(),
			)) as TmdbMovieDetail;
			const ref = detail.belongs_to_collection;
			return ref?.id ? { status: 'found', ref } : { status: 'none' };
		} catch {
			return { status: 'error' };
		}
	}

	async getTmdbCollection(collectionId: number): Promise<TmdbCollectionDetail | null> {
		if (!this.tmdbApiKey) return null;
		try {
			const data = (await this.fetchWithTimeout(
				`${TMDB_BASE}/collection/${collectionId}`,
				this.tmdbHeaders(),
			)) as TmdbCollectionDetail;
			return data.id ? data : null;
		} catch {
			return null;
		}
	}

	async getTmdbByImdbId(imdbId: string): Promise<MediaSearchResult | null> {
		if (!this.tmdbApiKey) return null;
		const url = `${TMDB_BASE}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`;
		try {
			const data = (await this.fetchWithTimeout(url, this.tmdbHeaders())) as TmdbFindResult;
			if (data.movie_results && data.movie_results.length > 0) {
				return this.getTmdbMovieDetails(String(data.movie_results[0]!.id));
			}
			if (data.tv_results && data.tv_results.length > 0) {
				return this.getTmdbTvDetails(String(data.tv_results[0]!.id));
			}
			return null;
		} catch {
			return null;
		}
	}

	// Community ratings

	private parseOmdbVotes(s: string | undefined): number {
		if (!s || s === 'N/A') return 0;
		const n = parseInt(s.replace(/,/g, ''), 10);
		return isNaN(n) ? 0 : n;
	}

	private parseOmdbRating(s: string | undefined): number {
		if (!s || s === 'N/A') return 0;
		const n = parseFloat(s);
		return isNaN(n) ? 0 : n;
	}

	private extractImdbId(externalLink: string): string {
		const m = externalLink.match(/tt\d+/);
		return m ? m[0] : '';
	}

	private async fetchMalRating(malId: number): Promise<{ rating: number; votes: number } | null> {
		try {
			const url = `${JIKAN_BASE}/anime/${malId}`;
			const data = (await this.fetchWithTimeout(url)) as {
				data?: { score?: number | null; scored_by?: number | null };
			};
			const rating = data.data?.score ?? 0;
			const votes = data.data?.scored_by ?? 0;
			if (!rating && !votes) return null;
			return { rating, votes };
		} catch {
			return null;
		}
	}

	private async fetchAniListRating(
		anilistId: number,
	): Promise<{ rating: number; votes: number } | null> {
		const media = await this.getAniListById(anilistId);
		if (!media) return null;
		const rating = media.averageScore ?? 0;
		const votes = media.popularity ?? 0;
		if (!rating && !votes) return null;
		return { rating, votes };
	}

	private async fetchOmdbRating(imdbId: string): Promise<{ rating: number; votes: number } | null> {
		if (!this.omdbApiKey) return null;
		try {
			const url = `${OMDB_BASE}/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(this.omdbApiKey)}`;
			const data = (await this.fetchWithTimeout(url)) as {
				Response?: string;
				imdbRating?: string;
				imdbVotes?: string;
			};
			if (data.Response === 'False') return null;
			const rating = this.parseOmdbRating(data.imdbRating);
			const votes = this.parseOmdbVotes(data.imdbVotes);
			if (!rating && !votes) return null;
			return { rating, votes };
		} catch {
			return null;
		}
	}

	private async fetchTmdbRatingByImdb(
		imdbId: string,
	): Promise<{ rating: number; votes: number } | null> {
		if (!this.tmdbApiKey) return null;
		try {
			const url = `${TMDB_BASE}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`;
			const data = (await this.fetchWithTimeout(url, this.tmdbHeaders())) as {
				movie_results?: Array<{ vote_average?: number; vote_count?: number }>;
				tv_results?: Array<{ vote_average?: number; vote_count?: number }>;
			};
			const hit =
				(data.movie_results && data.movie_results[0]) ||
				(data.tv_results && data.tv_results[0]) ||
				null;
			if (!hit) return null;
			const rating = hit.vote_average ?? 0;
			const votes = hit.vote_count ?? 0;
			if (!rating && !votes) return null;
			return { rating, votes };
		} catch {
			return null;
		}
	}

	/**
	 * Picks the API from the title's stored IDs and returns community rating + vote count +
	 * source label. null on failure or when no API fits.
	 */
	async fetchCommunityRating(
		title: WatchLogTitle,
		animeApiSource: 'jikan' | 'anilist' = 'jikan',
		apiGroup: 'anime' | 'movie' | '' = '',
	): Promise<{ rating: number; votes: number; source: 'mal' | 'anilist' | 'imdb' | 'tmdb' } | null> {
		const hasMal = (title.malId ?? 0) > 0;
		const hasAniList = (title.anilistId ?? 0) > 0;
		const resolvedGroup: 'anime' | 'movie' | '' =
			apiGroup || (title.type === 'Anime' ? 'anime' : title.type === 'Movie' || title.type === 'TV Show' || title.type === 'TvShow' ? 'movie' : '');

		if (resolvedGroup === '') return null;

		// the anime API group is bound to anime APIs
		if (resolvedGroup === 'anime') {
			if (animeApiSource === 'anilist') {
				if (hasAniList) {
					const r = await this.fetchAniListRating(title.anilistId!);
					if (r) return { ...r, source: 'anilist' };
				}
				if (hasMal) {
					const r = await this.fetchMalRating(title.malId!);
					if (r) return { ...r, source: 'mal' };
				}
			} else {
				if (hasMal) {
					const r = await this.fetchMalRating(title.malId!);
					if (r) return { ...r, source: 'mal' };
				}
				if (hasAniList) {
					const r = await this.fetchAniListRating(title.anilistId!);
					if (r) return { ...r, source: 'anilist' };
				}
			}
			// last resort: anime with no anime-api ID falls through to IMDb/TMDB
		}

		const imdbId = this.extractImdbId(title.externalLink ?? '');
		if (imdbId) {
			if (this.omdbApiKey) {
				const r = await this.fetchOmdbRating(imdbId);
				if (r) return { ...r, source: 'imdb' };
			}
			if (this.tmdbApiKey) {
				const r = await this.fetchTmdbRatingByImdb(imdbId);
				if (r) return { ...r, source: 'tmdb' };
			}
		}

		return null;
	}

	/**
	 * Re-fetches an existing title's trailer from its source, reusing the add-time paths:
	 * AniList/Jikan for anime (honouring `animeApiSource`, falling back to the other ID),
	 * TMDB-by-IMDb for movies/TV. OMDb and anything else yield 'none'.
	 */
	async fetchTrailer(
		title: WatchLogTitle,
		animeApiSource: 'jikan' | 'anilist' = 'jikan',
		apiGroup: 'anime' | 'movie' | '' = '',
	): Promise<string> {
		const resolvedGroup: 'anime' | 'movie' | '' =
			apiGroup || (title.type === 'Anime' ? 'anime' : title.type === 'Movie' || title.type === 'TV Show' || title.type === 'TvShow' ? 'movie' : '');

		if (resolvedGroup === 'anime') {
			const hasMal = (title.malId ?? 0) > 0;
			const hasAniList = (title.anilistId ?? 0) > 0;
			const tryAniList = async (): Promise<string> => {
				if (!hasAniList) return 'none';
				const media = await this.getAniListById(title.anilistId!);
				return media?.trailer?.site === 'youtube' && media.trailer.id
					? youtubeWatchUrl(media.trailer.id)
					: 'none';
			};
			const tryJikan = async (): Promise<string> => {
				if (!hasMal) return 'none';
				return this.getJikanTrailerByMalId(title.malId!);
			};
			const order = animeApiSource === 'anilist' ? [tryAniList, tryJikan] : [tryJikan, tryAniList];
			for (const attempt of order) {
				const url = await attempt();
				if (url && url !== 'none') return url;
			}
			return 'none';
		}

		if (resolvedGroup === 'movie') {
			const imdbId = this.extractImdbId(title.externalLink ?? '');
			// only TMDB carries trailers; OMDb never does
			if (imdbId && this.tmdbApiKey) {
				const full = await this.getTmdbByImdbId(imdbId);
				if (full?.trailerUrl && full.trailerUrl !== 'none') return full.trailerUrl;
			}
			return 'none';
		}

		return 'none';
	}

	/**
	 * One-time director/cast backfill for an existing title, keyed off the IMDb id in its
	 * stored externalLink. Prefers the active API, falls back to the other when it has a key.
	 * Returns normalized stored lists, or null when there is no usable id / no keyed API /
	 * the requests failed — the caller then marks the fields 'none' so it never re-attempts.
	 */
	async fetchCredits(
		title: WatchLogTitle,
		activeApi: 'OMDb' | 'TMDB' = 'OMDb',
	): Promise<{ director: string[]; cast: string[] } | null> {
		const imdbId = this.extractImdbId(title.externalLink ?? '');
		if (!imdbId) return null;

		// OMDb: Director/Actors ride in the plain detail response — one cheap call (deliberately
		// NOT getOmdbTvDetails, which fans out per-season requests)
		const tryOmdb = async (): Promise<{ director: string[]; cast: string[] } | null> => {
			if (!this.omdbApiKey) return null;
			try {
				const url = `${OMDB_BASE}/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(this.omdbApiKey)}`;
				const data = (await this.fetchWithTimeout(url)) as OmdbDetailResponse;
				if (data.Response === 'False' || !data.imdbID) return null;
				return {
					// series carry no per-title Director; their creators fill the field
					director:
						data.Type === 'series'
							? omdbSeriesDirectorCredits(data)
							: omdbNamesToCredits(data.Director),
					cast: omdbNamesToCredits(data.Actors),
				};
			} catch {
				return null;
			}
		};

		// TMDB: resolve the IMDb id via /find, then hit the lean /credits endpoint
		const tryTmdb = async (): Promise<{ director: string[]; cast: string[] } | null> => {
			if (!this.tmdbApiKey) return null;
			try {
				const findUrl = `${TMDB_BASE}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`;
				const found = (await this.fetchWithTimeout(findUrl, this.tmdbHeaders())) as TmdbFindResult;
				const movieId = found.movie_results?.[0]?.id;
				const tvId = found.tv_results?.[0]?.id;
				if (movieId !== undefined) {
					const credits = (await this.fetchWithTimeout(`${TMDB_BASE}/movie/${movieId}/credits`, this.tmdbHeaders())) as TmdbCreditsResult;
					return tmdbCreditsToStored(credits);
				}
				if (tvId === undefined) return null;
				// TV: the creators live on the detail response (created_by), not in /credits — fold the
				// cast lookup in via append_to_response
				const detail = (await this.fetchWithTimeout(
					`${TMDB_BASE}/tv/${tvId}?append_to_response=credits`,
					this.tmdbHeaders(),
				)) as TmdbTvDetail;
				return {
					director: tmdbSeriesDirectorCredits(detail),
					cast: tmdbCreditsToStored(detail.credits).cast,
				};
			} catch {
				return null;
			}
		};

		const order = activeApi === 'TMDB' ? [tryTmdb, tryOmdb] : [tryOmdb, tryTmdb];
		for (const attempt of order) {
			const result = await attempt();
			if (result) return result;
		}
		return null;
	}

	// Google Books (Books)

	/**
	 * Largest available cover from a volume's imageLinks, falling down extraLarge → large →
	 * medium → small → thumbnail → smallThumbnail. Returns a direct (200) HTTPS URL, upgraded
	 * from http and stripped of the page-curl effect, so no local caching is needed. '' when
	 * there is no image.
	 */
	private googleCoverUrl(info: GoogleVolumeInfo): string {
		const links = info.imageLinks;
		if (!links) return '';
		const raw =
			links.extraLarge ??
			links.large ??
			links.medium ??
			links.small ??
			links.thumbnail ??
			links.smallThumbnail ??
			'';
		if (!raw) return '';
		// bump Google's default cover (thumbnail is zoom=1 ≈ 128px, blurry on a card) to zoom=2 ≈
		// 300px — sharp yet light. Only thumbnail-class URLs carry a zoom param.
		return httpsOrEmpty(
			raw
				.replace(/^http:/, 'https:')
				.replace(/&edge=curl/g, '')
				.replace(/([?&]zoom=)\d+/, (_m, p1: string) => `${p1}2`),
		);
	}

	/** Normalizes Google's `publishedDate` (YYYY | YYYY-MM | YYYY-MM-DD) to YYYY-MM-DD. */
	private googleReleaseDate(published?: string): string {
		if (!published) return '';
		if (/^\d{4}-\d{2}-\d{2}$/.test(published)) return published;
		if (/^\d{4}-\d{2}$/.test(published)) return `${published}-01`;
		if (/^\d{4}$/.test(published)) return `${published}-01-01`;
		return published;
	}

	private mapGoogleVolume(item: GoogleVolume): BookSearchResult {
		const info = item.volumeInfo ?? {};
		const published = info.publishedDate ?? '';
		const year = published ? parseInt(published.slice(0, 4), 10) || 0 : 0;
		const fullTitle = info.subtitle ? `${info.title ?? ''}: ${info.subtitle}` : (info.title ?? '');
		return {
			title: fullTitle,
			author: (info.authors ?? []).join(', '),
			year,
			totalPages: info.pageCount ?? 0,
			coverUrl: this.googleCoverUrl(info),
			googleBooksId: item.id ?? '',
			releaseDate: this.googleReleaseDate(published),
			url: httpsOrEmpty(info.infoLink ?? info.canonicalVolumeLink),
		};
	}

	/**
	 * Google Books requests must always carry the user's API key — the anonymous endpoint
	 * shares a global quota and returns 429. Throws ApiError so callers can show an accurate
	 * message. `path` is everything after the base, e.g. `/volumes?q=...`; `key` is appended here.
	 */
	private async googleBooksFetch(path: string): Promise<unknown> {
		const key = this.googleBooksApiKey.trim();
		if (!key) {
			throw new ApiError('googleBooks', 'no-key', 'Google Books API key not set');
		}
		const sep = path.includes('?') ? '&' : '?';
		const url = `${GOOGLE_BOOKS_BASE}${path}${sep}key=${encodeURIComponent(key)}`;
		let timer: number | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new ApiError('googleBooks', 'network', 'Request timed out')), API_TIMEOUT_MS);
		});
		try {
			// classifyHttp splits Google's overloaded 403 (quota vs disabled API vs bad key) on the body
			const reqPromise = requestUrl({ url, throw: false }).then((r) => readApiResponse('googleBooks', r));
			return await Promise.race([reqPromise, timeoutPromise]);
		} catch (err) {
			if (err instanceof ApiError) throw err;
			throw new ApiError('googleBooks', 'network', (err as Error)?.message ?? 'Network error');
		} finally {
			if (timer !== null) window.clearTimeout(timer);
		}
	}

	/** Throws GoogleBooksError on failure — see googleBooksErrorMessage. */
	async searchGoogleBooks(query: string): Promise<BookSearchResult[]> {
		const data = (await this.googleBooksFetch(
			`/volumes?q=${encodeURIComponent(query)}&maxResults=10`,
		)) as GoogleBooksResponse;
		return (data.items ?? []).slice(0, 10).map((item) => this.mapGoogleVolume(item));
	}

	/** Resolves on success, throws GoogleBooksError so the test can report the real cause. */
	async checkGoogleBooksConnection(): Promise<boolean> {
		const data = (await this.googleBooksFetch('/volumes?q=tolkien&maxResults=1')) as GoogleBooksResponse;
		return Array.isArray(data.items);
	}

	// Jikan (Manga)

	private mapJikanManga(m: JikanMangaItem): MangaSearchResult {
		const yearStr = m.published?.from ?? '';
		const year = yearStr ? parseInt(yearStr.slice(0, 4), 10) || 0 : 0;
		return {
			malId: m.mal_id,
			title: m.title_english ?? m.title,
			author: (m.authors ?? []).map((a) => a.name).join(', '),
			year,
			totalChapters: m.chapters ?? 0,
			totalVolumes: m.volumes ?? 0,
			coverUrl: httpsOrEmpty(m.images?.jpg?.large_image_url ?? m.images?.jpg?.image_url),
			releaseDate: m.published?.from ? (m.published.from.split('T')[0] ?? '') : '',
			url: httpsOrEmpty(m.url) || `https://myanimelist.net/manga/${m.mal_id}`,
		};
	}

	/** throws ApiError */
	async searchManga(query: string): Promise<MangaSearchResult[]> {
		const url = `${JIKAN_BASE}/manga?q=${encodeURIComponent(query)}&limit=10`;
		const data = (await this.throttleJikan(() => this.fetchWithTimeout(url))) as { data?: JikanMangaItem[] };
		return (data.data ?? []).map((m) => this.mapJikanManga(m));
	}

	/**
	 * Detail lookup for one manga (Jikan /manga/{mal_id}). Search-list results return null
	 * chapters/volumes for ongoing titles, so totals are fetched here on selection. Shares
	 * the Jikan throttle.
	 */
	async getMangaByMalId(malId: number): Promise<MangaSearchResult | null> {
		const url = `${JIKAN_BASE}/manga/${malId}`;
		try {
			const data = (await this.throttleJikan(() => this.fetchWithTimeout(url))) as { data?: JikanMangaItem };
			if (!data.data) return null;
			return this.mapJikanManga(data.data);
		} catch {
			return null;
		}
	}

	/**
	 * Detail lookup for one Google Books volume. The search endpoint sometimes omits
	 * pageCount and only returns thumbnails, so selection resolves the full volume. null when
	 * it can't be fetched.
	 */
	async getGoogleBookById(volumeId: string): Promise<BookSearchResult | null> {
		if (!volumeId) return null;
		const item = (await this.googleBooksFetch(`/volumes/${encodeURIComponent(volumeId)}`)) as GoogleVolume;
		if (!item || !item.id) return null;
		return this.mapGoogleVolume(item);
	}

	/** Resolves on success, throws ApiError so the test can report the real cause. */
	async checkTmdbConnection(): Promise<boolean> {
		if (!this.tmdbApiKey) throw new ApiError('tmdb', 'no-key', 'TMDB token not set');
		const url = `${TMDB_BASE}/movie/550`;
		const data = (await this.fetchWithTimeout(url, this.tmdbHeaders())) as { id?: number };
		return data.id !== undefined;
	}

	/** Resolves on success, throws ApiError so the test can report the real cause. */
	async checkOmdbConnection(): Promise<boolean> {
		if (!this.omdbApiKey) throw new ApiError('omdb', 'no-key', 'OMDb API key not set');
		// a known IMDb ID (The Shawshank Redemption) as a connectivity test
		const url = `${OMDB_BASE}/?i=tt0111161&apikey=${encodeURIComponent(this.omdbApiKey)}`;
		const data = (await this.fetchWithTimeout(url)) as OmdbDetailResponse;
		assertOmdbOk(data);
		return data.Response === 'True';
	}

	// Games — RAWG

	private mapRawgGame(g: RawgGame): GameSearchResult {
		return {
			source: 'rawg',
			id: g.id,
			title: g.name ?? '',
			releaseDate: g.released ?? '',
			coverUrl: httpsOrEmpty(g.background_image),
			platforms: (g.platforms ?? [])
				.map((p) => p.platform?.name ?? '')
				.filter((n) => n !== ''),
			url: g.slug ? `https://rawg.io/games/${g.slug}` : '',
		};
	}

	/** throws ApiError */
	async searchRawgGames(query: string): Promise<GameSearchResult[]> {
		if (!this.hasRawgKey()) throw new ApiError('rawg', 'no-key', 'RAWG API key not set');
		const url = `${RAWG_BASE}/games?key=${encodeURIComponent(this.rawgApiKey)}&search=${encodeURIComponent(query)}&page_size=10`;
		const data = (await this.fetchWithTimeout(url)) as RawgSearchResponse;
		return (data.results ?? [])
			.filter((g) => typeof g.id === 'number' && !!g.name)
			.map((g) => this.mapRawgGame(g));
	}

	/**
	 * Detail + store links for one RAWG game (two parallel requests — the detail payload's own
	 * `stores` array carries no per-game URLs). Store pick follows RAWG_STORE_PRIORITY, else
	 * the first store with a URL.
	 */
	async getRawgGameDetails(id: number): Promise<GameDetailsResult | null> {
		const key = encodeURIComponent(this.rawgApiKey);
		const [detail, stores] = await Promise.all([
			this.fetchWithTimeout(`${RAWG_BASE}/games/${id}?key=${key}`) as Promise<RawgGameDetail>,
			(this.fetchWithTimeout(`${RAWG_BASE}/games/${id}/stores?key=${key}`) as Promise<RawgStoresResponse>)
				.catch((): RawgStoresResponse => ({ results: [] })),
		]);
		if (typeof detail.id !== 'number' || !detail.name) return null;

		const storeLinks = (stores.results ?? []).filter((s) => !!httpsOrEmpty(s.url));
		let storeUrl = '';
		for (const storeId of RAWG_STORE_PRIORITY) {
			const hit = storeLinks.find((s) => s.store_id === storeId);
			if (hit) { storeUrl = hit.url!; break; }
		}
		if (!storeUrl && storeLinks.length > 0) storeUrl = storeLinks[0]!.url!;

		// game modes come from the (english) tag slugs
		const tagSlugs = new Set(
			(detail.tags ?? [])
				.filter((t) => (t.language ?? 'eng') === 'eng' && t.slug)
				.map((t) => t.slug!),
		);

		return {
			...this.mapRawgGame(detail),
			developer: (detail.developers ?? []).map((d) => d.name ?? '').filter(Boolean).join(', '),
			publisher: (detail.publishers ?? []).map((p) => p.name ?? '').filter(Boolean).join(', '),
			singleplayer: tagSlugs.has('singleplayer'),
			coop: RAWG_COOP_TAGS.some((t) => tagSlugs.has(t)),
			multiplayer: RAWG_MULTIPLAYER_TAGS.some((t) => tagSlugs.has(t)),
			storeUrl,
		};
	}

	/** Resolves on success, throws ApiError so the test can report the real cause. */
	async checkRawgConnection(): Promise<boolean> {
		if (!this.hasRawgKey()) throw new ApiError('rawg', 'no-key', 'RAWG API key not set');
		const url = `${RAWG_BASE}/games?key=${encodeURIComponent(this.rawgApiKey)}&page_size=1`;
		const data = (await this.fetchWithTimeout(url)) as RawgSearchResponse;
		return Array.isArray(data.results);
	}

	// Games — IGDB (via Twitch OAuth)

	/**
	 * A valid IGDB app access token, fetching a fresh one through the Twitch
	 * client-credentials flow when none is cached or the cache expired (60 s margin).
	 * Throws when credentials are missing or rejected.
	 */
	private async getIgdbToken(): Promise<string> {
		if (!this.hasIgdbCredentials()) throw new ApiError('twitch', 'no-key', 'IGDB credentials not set');
		if (this.igdbToken && Date.now() < this.igdbTokenExpiry) return this.igdbToken;

		const url =
			`${TWITCH_TOKEN_URL}?client_id=${encodeURIComponent(this.igdbClientId)}` +
			`&client_secret=${encodeURIComponent(this.igdbClientSecret)}` +
			`&grant_type=client_credentials`;
		let timer: number | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new ApiError('twitch', 'network', 'Request timed out')), API_TIMEOUT_MS);
		});
		try {
			// source 'twitch', not 'igdb' — a rejected Client ID/Secret is a different fix from a
			// rejected query, and the two used to give the same message
			const fetchPromise = requestUrl({ url, method: 'POST', throw: false })
				.then((r) => readApiResponse('twitch', r) as TwitchTokenResponse);
			const data = await Promise.race([fetchPromise, timeoutPromise]);
			if (!data.access_token) throw new ApiError('twitch', 'auth', 'Twitch returned no access token');
			this.igdbToken = data.access_token;
			this.igdbTokenExpiry = Date.now() + Math.max(0, (data.expires_in ?? 0) - 60) * 1000;
			return this.igdbToken;
		} catch (err) {
			if (err instanceof ApiError) throw err;
			throw new ApiError('twitch', 'network', (err as Error)?.message ?? 'Network error');
		} finally {
			if (timer !== null) window.clearTimeout(timer);
		}
	}

	/** POSTs an Apicalypse query (plain-text body) to an IGDB endpoint. */
	private async igdbPost(endpoint: string, query: string): Promise<unknown> {
		const token = await this.getIgdbToken();
		let timer: number | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new ApiError('igdb', 'network', 'Request timed out')), API_TIMEOUT_MS);
		});
		try {
			const fetchPromise = requestUrl({
				url: `${IGDB_BASE}/${endpoint}`,
				method: 'POST',
				headers: {
					'Client-ID': this.igdbClientId,
					'Authorization': `Bearer ${token}`,
				},
				body: query,
				throw: false,
			}).then((r) => readApiResponse('igdb', r));
			return await Promise.race([fetchPromise, timeoutPromise]);
		} catch (e) {
			// a rejected token (revoked / expired early) must not poison the cache
			this.igdbToken = '';
			this.igdbTokenExpiry = 0;
			if (e instanceof ApiError) throw e;
			throw new ApiError('igdb', 'network', (e as Error)?.message ?? 'Network error');
		} finally {
			if (timer !== null) window.clearTimeout(timer);
		}
	}

	private mapIgdbGame(g: IgdbGame): GameSearchResult {
		const ts = g.first_release_date;
		// deliberately UTC, not the local toIsoDate: IGDB gives a UTC epoch for the release *day*,
		// so converting locally shifts the date by one for anyone west of UTC
		const releaseDate =
			typeof ts === 'number' && ts > 0
				? new Date(ts * 1000).toISOString().split('T')[0] ?? ''
				: '';
		return {
			source: 'igdb',
			id: g.id,
			title: g.name ?? '',
			releaseDate,
			coverUrl: g.cover?.image_id
				? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`
				: '',
			platforms: (g.platforms ?? []).map((p) => p.name ?? '').filter((n) => n !== ''),
			url: httpsOrEmpty(g.url),
		};
	}

	async searchIgdbGames(query: string): Promise<GameSearchResult[]> {
		// Apicalypse strings are double-quoted — strip quotes/backslashes from input.
		const safe = query.replace(/["\\]/g, ' ').trim();
		const data = (await this.igdbPost(
			'games',
			`search "${safe}"; fields name, first_release_date, cover.image_id, platforms.name, url; limit 10;`,
		)) as IgdbGame[];
		return (Array.isArray(data) ? data : [])
			.filter((g) => typeof g.id === 'number' && !!g.name)
			.map((g) => this.mapIgdbGame(g));
	}

	async getIgdbGameDetails(id: number): Promise<GameDetailsResult | null> {
		const data = (await this.igdbPost(
			'games',
			'fields name, first_release_date, cover.image_id, platforms.name, url, ' +
				'game_modes.name, websites.url, ' +
				'involved_companies.developer, involved_companies.publisher, involved_companies.company.name; ' +
				`where id = ${id | 0}; limit 1;`,
		)) as IgdbGame[];
		const g = Array.isArray(data) ? data[0] : undefined;
		if (!g || !g.name) return null;

		const companies = g.involved_companies ?? [];
		const names = (list: typeof companies): string =>
			[...new Set(list.map((c) => c.company?.name ?? '').filter(Boolean))].join(', ');

		const modes = new Set((g.game_modes ?? []).map((m) => m.name ?? ''));
		const siteUrls = (g.websites ?? []).map((w) => httpsOrEmpty(w.url)).filter(Boolean);
		let storeUrl = '';
		for (const domain of IGDB_STORE_DOMAINS) {
			const hit = siteUrls.find((u) => u.includes(domain));
			if (hit) { storeUrl = hit; break; }
		}

		return {
			...this.mapIgdbGame(g),
			developer: names(companies.filter((c) => c.developer === true)),
			publisher: names(companies.filter((c) => c.publisher === true)),
			singleplayer: modes.has('Single player'),
			coop: [...modes].some((m) => IGDB_COOP_MODES.has(m)),
			multiplayer: [...modes].some((m) => IGDB_MULTIPLAYER_MODES.has(m)),
			storeUrl,
		};
	}

	/** Resolves on success, throws ApiError so the test can report the real cause. */
	async checkIgdbConnection(): Promise<boolean> {
		if (!this.hasIgdbCredentials()) throw new ApiError('twitch', 'no-key', 'IGDB credentials not set');
		const data = await this.igdbPost('games', 'fields id; limit 1;');
		return Array.isArray(data);
	}

	// Games — Steam (Web API + Storefront). Not a search source: the Storefront API has no
	// search endpoint and the only name index (ISteamApps/GetAppList) is a ~200k-entry,
	// multi-MB download. So it never backs AddGameModal — it fills in playtime and
	// achievements from the user's own account, which no other API can.

	setSteamCredentials(apiKey: string, steamId: string): void {
		this.steamApiKey = apiKey;
		this.steamId = steamId;
	}

	hasSteamCredentials(): boolean {
		return this.steamApiKey.trim().length > 0 && this.steamId.trim().length > 0;
	}

	/**
	 * GET returning the raw status alongside the parsed body. The Steam endpoints signal real,
	 * expected conditions through status codes (no achievements = 400, locked-down profile =
	 * 403), so unlike fetchWithTimeout these must not collapse into a thrown error.
	 */
	private async steamGet(url: string): Promise<{ status: number; json: unknown }> {
		let timer: number | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new Error('Request timed out')), API_TIMEOUT_MS);
		});
		try {
			const fetchPromise = requestUrl({ url, throw: false }).then((r) => {
				let json: unknown = null;
				// .json throws on a non-JSON body (Steam serves HTML error pages).
				try { json = JSON.parse(r.text) as unknown; } catch { json = null; }
				return { status: r.status, json };
			});
			return await Promise.race([fetchPromise, timeoutPromise]);
		} finally {
			if (timer !== null) window.clearTimeout(timer);
		}
	}

	/**
	 * Normalizes whatever the user pasted into a SteamID64: the id itself, a profile URL of
	 * either shape, or a bare vanity name (resolved through the API). '' when unresolvable.
	 */
	async resolveSteamId(input: string): Promise<string> {
		const raw = input.trim();
		if (raw === '') return '';

		// a 17-digit number is already a SteamID64
		if (/^\d{17}$/.test(raw)) return raw;

		// .../profiles/<steamid64> — the id is right there
		const profileMatch = raw.match(/steamcommunity\.com\/profiles\/(\d{17})/);
		if (profileMatch) return profileMatch[1] ?? '';

		// .../id/<vanity> or a bare vanity name — needs the resolve endpoint
		const vanityMatch = raw.match(/steamcommunity\.com\/id\/([^/?#]+)/);
		const vanity = vanityMatch ? vanityMatch[1] ?? '' : raw;
		if (vanity === '' || this.steamApiKey.trim() === '') return '';

		try {
			const url = `${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/`
				+ `?key=${encodeURIComponent(this.steamApiKey)}`
				+ `&vanityurl=${encodeURIComponent(vanity)}`;
			const { json } = await this.steamGet(url);
			const res = (json as SteamVanityResponse | null)?.response;
			return res?.success === 1 ? (res.steamid ?? '') : '';
		} catch {
			return '';
		}
	}

	/**
	 * The user's owned games with playtime. One request for the whole library.
	 *
	 * A private profile is the most common failure here and it does NOT error — Steam answers
	 * 200 with an empty `response` object — so the result distinguishes it from "you genuinely
	 * own nothing" for the caller's message.
	 */
	async getSteamOwnedGames(): Promise<SteamLibraryResult> {
		if (!this.hasSteamCredentials()) return { ok: false, reason: 'missing', games: [] };
		try {
			const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/`
				+ `?key=${encodeURIComponent(this.steamApiKey)}`
				+ `&steamid=${encodeURIComponent(this.steamId)}`
				+ '&include_appinfo=1&include_played_free_games=1';
			const { status, json } = await this.steamGet(url);
			if (status === 401 || status === 403) return { ok: false, reason: 'badKey', games: [] };
			if (status !== 200) return { ok: false, reason: 'network', games: [] };

			const res = (json as SteamOwnedGamesResponse | null)?.response;
			// {} rather than { game_count: 0, games: [] } — the private-profile shape.
			if (!res || res.games === undefined) {
				return { ok: false, reason: res && res.game_count === 0 ? 'empty' : 'private', games: [] };
			}
			const games = res.games.map((g) => ({
				appId: String(g.appid),
				name: g.name ?? '',
				playtimeMinutes: g.playtime_forever ?? 0,
				lastPlayed: g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : null,
			}));
			return { ok: true, reason: 'ok', games };
		} catch {
			return { ok: false, reason: 'network', games: [] };
		}
	}

	/**
	 * Earned / total achievements for one app. One request per game — the only part of a sync
	 * that scales with library size.
	 *
	 * Returns null for "this game has no achievements", which Steam reports as a 400 with an
	 * error payload rather than an empty list; treating that as a failure would mark a large
	 * slice of any real library as broken.
	 */
	async getSteamAchievements(appId: string): Promise<{ earned: number; total: number } | null> {
		if (!this.hasSteamCredentials()) return null;
		try {
			const url = `${STEAM_API_BASE}/ISteamUserStats/GetPlayerAchievements/v1/`
				+ `?key=${encodeURIComponent(this.steamApiKey)}`
				+ `&steamid=${encodeURIComponent(this.steamId)}`
				+ `&appid=${encodeURIComponent(appId)}`;
			const { status, json } = await this.steamGet(url);
			if (status !== 200) return null;
			const stats = (json as SteamAchievementsResponse | null)?.playerstats;
			if (!stats?.success || !Array.isArray(stats.achievements)) return null;
			return {
				earned: stats.achievements.filter((a) => a.achieved === 1).length,
				total: stats.achievements.length,
			};
		} catch {
			return null;
		}
	}

	/**
	 * Storefront metadata for one app — no key, but rate-limited (~200 requests per 5 minutes
	 * per IP), so callers must throttle. Only used when importing a game the library doesn't
	 * have yet.
	 */
	async getSteamAppDetails(appId: string): Promise<SteamAppDetails | null> {
		try {
			const url = `${STEAM_STORE_BASE}/appdetails?appids=${encodeURIComponent(appId)}`;
			const { status, json } = await this.steamGet(url);
			if (status !== 200 || !json) return null;
			const entry = (json as Record<string, SteamAppDetailsEntry | undefined>)[appId];
			if (!entry?.success || !entry.data) return null;
			const d = entry.data;

			const categoryIds = new Set((d.categories ?? []).map((c) => c.id));
			return {
				name: d.name ?? '',
				developer: (d.developers ?? []).join(', '),
				publisher: (d.publishers ?? []).join(', '),
				genres: (d.genres ?? []).map((g) => g.description ?? '').filter((g) => g !== ''),
				releaseDate: parseSteamReleaseDate(d.release_date?.date ?? ''),
				coverUrl: steamLibraryCover(appId),
				storeUrl: `https://store.steampowered.com/app/${appId}/`,
				singleplayer: categoryIds.has(STEAM_CAT_SINGLEPLAYER),
				coop: [...categoryIds].some((id) => STEAM_COOP_CATS.has(id)),
				multiplayer: categoryIds.has(STEAM_CAT_MULTIPLAYER),
			};
		} catch {
			return null;
		}
	}

	/** Test-connection probe: one GetOwnedGames call, reported by reason. */
	async checkSteamConnection(): Promise<SteamLibraryResult> {
		return this.getSteamOwnedGames();
	}
}

// Steam helpers

/**
 * The portrait library capsule. Steam's `header_image` is a 460×215 landscape banner that
 * letterboxes badly in portrait poster cards; the 600×900 capsule is the shape the grid
 * expects. Not every app publishes one — the card's onerror falls back to the placeholder.
 */
export function steamLibraryCover(appId: string): string {
	return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
}

/** Steam appid out of a store URL, '' when the URL isn't a Steam store page. */
export function steamAppIdFromUrl(url: string): string {
	return url.match(/store\.steampowered\.com\/app\/(\d+)/)?.[1] ?? '';
}

/**
 * Storefront release dates are display strings in the store's locale ('12 Mar, 2020',
 * 'Mar 12, 2020', 'Q1 2021', 'Coming soon'). Only a fully resolved day converts; anything
 * vaguer returns null rather than a guess, because releaseDate drives the auto
 * "To be released" status.
 */
export function parseSteamReleaseDate(raw: string): string | null {
	const text = raw.trim();
	if (text === '') return null;
	const parsed = Date.parse(text);
	if (Number.isNaN(parsed)) return null;
	const d = new Date(parsed);
	// local getters, not toISOString — see the date rules in types.ts
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * RAWG's `background_image` is a full-resolution screenshot (routinely 3840×2160,
 * multi-MB) — far too heavy for a 140×210 poster card; the fetch + decode is what made
 * Games covers flash their letter placeholder and stutter the grid scroll. media.rawg.io
 * exposes an on-the-fly resize endpoint (`/media/resize/<width>/-/<path>`), so display
 * sites rewrite through this helper instead of storing a downscaled URL. Non-RAWG and
 * already-resized URLs pass through untouched.
 */
export function rawgResizedCover(url: string, width = 640): string {
	const prefix = 'https://media.rawg.io/media/';
	if (!url.startsWith(prefix)) return url;
	const rest = url.slice(prefix.length);
	if (rest.startsWith('resize/') || rest.startsWith('crop/')) return url;
	return `${prefix}resize/${width}/-/${rest}`;
}

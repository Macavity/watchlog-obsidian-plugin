import type { Season, DraftPersistState, SavedFilterPreset, RecommendedDaily } from '../types';

/** The four kinds of library entry, each backed by one note. */
export type EntryKind = 'title' | 'book' | 'manga' | 'game';

/** One episode in S/E notation (both 1-based). */
export interface EpisodeRef {
	season: number;
	episode: number;
}

export type ExternalSource = 'tmdb' | 'imdb' | 'mal' | 'anilist' | 'gbooks' | 'rawg' | 'igdb';

/** Primary API identity of an entry, stored in frontmatter as `externalId`. */
export interface ExternalId {
	source: ExternalSource;
	kind?: 'movie' | 'tv' | 'anime' | 'manga';
	id: string;
}

/** API-derived data per entry; regenerable, so it lives in data.json only. */
export type ApiCheckResult = 'ok' | 'transient' | 'nokey' | 'notfound';

export interface EntryCache {
	/** only the marker 'none' = the poster fetch found nothing; posters live in the note (E12) */
	posterUrl?: string;
	trailerUrl?: string;
	director?: string[];
	cast?: string[];
	studio?: string[];
	communityRating?: number;
	communityVotes?: number;
	communitySource?: string;
	communityRatingLastFetched?: string;
	collectionId?: number;
	seasons?: Season[];
	tmdbId?: number;
	tmdbMediaType?: 'movie' | 'tv';
	malId?: number;
	anilistId?: number;
	/** last background API check per kind: when, and how it ended (drives the retry deadline) */
	apiCheck?: Partial<Record<'airing' | 'seasons', { at: string; result: ApiCheckResult }>>;
	/** next/last aired episode from TMDB or AniList; season-relative episode numbers */
	airing?: {
		nextSeason?: number;
		nextEpisode?: number;
		nextAirDate?: string;
		lastSeason?: number;
		lastEpisode?: number;
		refreshedAt: string;
	};
}

/** A decoded note: the entry plus frontmatter fields whose values could not be read. */
export interface Decoded<T> {
	entry: T;
	invalidFields: string[];
}

export interface YamlIO {
	parse(src: string): unknown;
	stringify(obj: unknown): string;
}

/** The `watchlog:` block of WatchLog.base. */
export interface SharedConfig {
	version: number;
	settings: Record<string, unknown>;
}

/** data.json in schema 2: device-local settings, secrets, cache and UI state. */
export interface LocalData {
	schemaVersion: 2;
	settings: Record<string, unknown>;
	/** device-local part of the reading / games settings (colors, layouts, saved filters) */
	reading?: Record<string, unknown>;
	games?: Record<string, unknown>;
	cache: Record<string, EntryCache>;
	drafts?: DraftPersistState;
	ui: {
		collapsedSeasons?: Record<string, number[]>;
		pinnedGroup?: string | null;
		savedFilterPreset?: SavedFilterPreset | null;
		recommendedDaily?: RecommendedDaily;
	};
}

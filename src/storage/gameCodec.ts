import { formatTime } from '../types';
import type { Game } from '../types';
import type { Decoded } from './storageTypes';
import { parseExternalId, formatExternalId } from './externalId';
import { FmReader, decodeAirtime, encodeAirtime } from './readingCodec';

type Fm = Record<string, unknown>;

const PLAYTIME_RE = /^(?:(\d{1,3}(?:,\d{3})+|\d+)h)?(?: ?(\d+)m)?$/;

/** Inverse of formatTime ("12h 30m", "1,234h", "45m"); null when unparseable. */
export function parsePlaytime(s: string): number | null {
	const t = s.trim();
	const m = PLAYTIME_RE.exec(t);
	if (!t || !m) return null;
	const h = m[1] ? Number(m[1].replace(/,/g, '')) : 0;
	return h * 60 + (m[2] ? Number(m[2]) : 0);
}

export function decodeGame(id: string, fm: Fm): Decoded<Game> {
	const r = new FmReader(fm);
	const ext = parseExternalId(r.str('externalId'));
	let apiSource: Game['apiSource'] = '';
	let apiId = '';
	if (ext && (ext.source === 'rawg' || ext.source === 'igdb')) {
		apiSource = ext.source;
		apiId = ext.id;
	} else {
		const src = r.str('apiSource');
		if (src === 'rawg' || src === 'igdb') {
			apiSource = src;
			apiId = r.str('apiId');
		}
	}

	let playtimeMinutes = 0;
	const pt = r.str('playtime');
	if (pt) {
		const p = parsePlaytime(pt);
		if (p === null) r.invalidFields.push('playtime');
		else playtimeMinutes = p;
	}

	let achievementsEarned = 0;
	let achievementsTotal = 0;
	const ach = r.str('achievements');
	if (ach) {
		const m = /^(\d+)\s*\/\s*(\d+)$/.exec(ach.trim());
		if (m) {
			achievementsEarned = Number(m[1]);
			achievementsTotal = Number(m[2]);
		} else r.invalidFields.push('achievements');
	}

	const entry: Game = {
		id,
		title: r.str('title'),
		developer: r.str('developer'),
		publisher: r.str('publisher'),
		type: r.str('genre'),
		status: r.str('status'),
		priority: r.str('priority'),
		favorite: r.bool('favorite'),
		dateFavorited: r.strOrNull('dateFavorited') ?? undefined,
		wishlist: r.bool('wishlist'),
		rating: r.num('rating'),
		progress: r.num('progress'),
		playtimeMinutes,
		achievementsEarned,
		achievementsTotal,
		platforms: r.list('platforms'),
		singleplayer: r.bool('singleplayer'),
		coop: r.bool('coop'),
		multiplayer: r.bool('multiplayer'),
		coverUrl: r.str('coverUrl'),
		apiSource,
		apiId,
		steamAppId: r.str('steamAppId'),
		lastPlayed: r.strOrNull('lastPlayed'),
		storeUrl: r.str('storeUrl'),
		externalLink: r.str('externalLink'),
		vaultPage: `${id}.md`,
		releaseDate: r.strOrNull('releaseDate'),
		dateStarted: r.strOrNull('dateStarted'),
		dateFinished: r.strOrNull('dateFinished'),
		dateAdded: r.str('dateAdded'),
		dateModified: r.str('dateModified'),
		groups: r.list('groups'),
		airtime: decodeAirtime(r),
	};
	if (entry.coverUrl) entry.coverOverride = true;
	if (!entry.dateFavorited) delete entry.dateFavorited;
	if (!entry.groups?.length) delete entry.groups;
	if (!entry.airtime) delete entry.airtime;
	return { entry, invalidFields: r.invalidFields };
}

export function encodeGame(g: Game): Fm {
	const out: Fm = {};
	out.title = g.title;
	out.developer = g.developer ?? '';
	out.publisher = g.publisher ?? '';
	// `genre` carries the in-app type; `type:` stays the cross-note kind marker
	out.genre = g.type ?? '';
	out.status = g.status;
	if (g.priority) out.priority = g.priority;
	if (g.favorite) out.favorite = true;
	if (g.dateFavorited) out.dateFavorited = g.dateFavorited;
	if (g.wishlist) out.wishlist = true;
	out.rating = g.rating | 0;
	out.progress = g.progress | 0;
	if (g.playtimeMinutes > 0) out.playtime = formatTime(g.playtimeMinutes);
	if (g.achievementsTotal > 0) out.achievements = `${g.achievementsEarned}/${g.achievementsTotal}`;
	if (g.platforms.length > 0) out.platforms = [...g.platforms];
	if (g.singleplayer) out.singleplayer = true;
	if (g.coop) out.coop = true;
	if (g.multiplayer) out.multiplayer = true;
	out.dateStarted = g.dateStarted ?? null;
	out.dateFinished = g.dateFinished ?? null;
	out.releaseDate = g.releaseDate ?? null;
	out.dateAdded = g.dateAdded;
	out.dateModified = g.dateModified;
	// a cover only in the cache is the API's; one from the note is the user's (E9)
	if (g.coverOverride && g.coverUrl) out.coverUrl = g.coverUrl;
	if (g.storeUrl) out.storeUrl = g.storeUrl;
	if (g.externalLink) out.externalLink = g.externalLink;
	if (g.apiSource && g.apiId) out.externalId = formatExternalId({ source: g.apiSource, id: g.apiId });
	if (g.steamAppId) out.steamAppId = g.steamAppId;
	if (g.lastPlayed) out.lastPlayed = g.lastPlayed;
	if (g.groups?.length) out.groups = [...g.groups];
	encodeAirtime(g.airtime, out);
	out.type = 'game';
	return out;
}

import { READING_STATUSES } from '../types';
import type { Book, Manga, EntryAirtime, AirtimeRecurrence, ReadingStatus } from '../types';
import type { Decoded } from './storageTypes';
import { parseExternalId, formatExternalId } from './externalId';

type Fm = Record<string, unknown>;

/** Typed frontmatter reader; a present value of the wrong type is recorded and replaced by the fallback. */
export class FmReader {
	readonly invalidFields: string[] = [];
	constructor(readonly fm: Fm) {}

	private has(key: string): boolean {
		const v = this.fm[key];
		return v !== undefined && v !== null && v !== '';
	}
	private bad(key: string): void {
		if (!this.invalidFields.includes(key)) this.invalidFields.push(key);
	}

	str(key: string, fallback = ''): string {
		const v = this.fm[key];
		if (!this.has(key)) return fallback;
		if (typeof v === 'string') return v;
		if (typeof v === 'number') return String(v);
		this.bad(key);
		return fallback;
	}
	/** String that may be absent; null/empty both read as null. */
	strOrNull(key: string): string | null {
		const v = this.fm[key];
		if (!this.has(key)) return null;
		if (typeof v === 'string') return v;
		this.bad(key);
		return null;
	}
	num(key: string, fallback = 0): number {
		const v = this.fm[key];
		if (!this.has(key)) return fallback;
		if (typeof v === 'number' && Number.isFinite(v)) return v;
		this.bad(key);
		return fallback;
	}
	bool(key: string): boolean {
		const v = this.fm[key];
		if (!this.has(key)) return false;
		if (typeof v === 'boolean') return v;
		this.bad(key);
		return false;
	}
	list(key: string): string[] {
		const v = this.fm[key];
		if (!this.has(key)) return [];
		if (typeof v === 'string') return [v];
		if (Array.isArray(v) && v.every(x => typeof x === 'string')) return v;
		this.bad(key);
		return [];
	}
}

const RECURRENCES: readonly AirtimeRecurrence[] = ['once', 'daily', 'weekly', 'monthly'];

export function decodeAirtime(r: FmReader): EntryAirtime | undefined {
	const rec = r.str('airtimeRecurrence');
	if (!rec) return undefined;
	if (!(RECURRENCES as readonly string[]).includes(rec)) {
		r.invalidFields.push('airtimeRecurrence');
		return undefined;
	}
	const a: EntryAirtime = { recurrence: rec as AirtimeRecurrence };
	if (r.fm.airtimeDay != null && r.fm.airtimeDay !== '') a.day = r.num('airtimeDay');
	const time = r.str('airtimeTime');
	if (time) a.time = time;
	if (r.fm.airtimeSeason != null && r.fm.airtimeSeason !== '') a.season = r.num('airtimeSeason');
	if (r.fm.airtimeEpisode != null && r.fm.airtimeEpisode !== '') a.episode = r.num('airtimeEpisode');
	const ack = r.str('airtimeAcknowledged');
	if (ack) a.acknowledged = ack;
	return a;
}

export function encodeAirtime(a: EntryAirtime | undefined, out: Fm): void {
	if (!a) return;
	out.airtimeRecurrence = a.recurrence;
	if (a.day !== undefined) out.airtimeDay = a.day;
	if (a.time) out.airtimeTime = a.time;
	if (a.season !== undefined) out.airtimeSeason = a.season;
	if (a.episode !== undefined) out.airtimeEpisode = a.episode;
	if (a.acknowledged) out.airtimeAcknowledged = a.acknowledged;
}

function decodeCustomFields(r: FmReader): Record<string, string | number> {
	const cf: Record<string, string | number> = {};
	for (const [k, v] of Object.entries(r.fm)) {
		if (!k.startsWith('cf_') || k.length === 3) continue;
		if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) cf[k.slice(3)] = v;
		else if (v !== null && v !== undefined) r.invalidFields.push(k);
	}
	return cf;
}

function status(r: FmReader): ReadingStatus {
	const s = r.str('status');
	if ((READING_STATUSES as string[]).includes(s)) return s as ReadingStatus;
	if (s) r.invalidFields.push('status');
	return 'Plan to Read';
}

/** Keys shared by Book and Manga, in the order the legacy writer emitted them. */
function encodeCommon(e: Book | Manga, out: Fm): void {
	out.title = e.title;
	out.author = e.author ?? '';
	out.status = e.status;
	if (e.favorite) out.favorite = true;
	if (e.dateFavorited) out.dateFavorited = e.dateFavorited;
	out.rating = e.rating | 0;
}

function encodeTail(e: Book | Manga, kind: 'book' | 'manga', out: Fm): void {
	out.dateStarted = e.dateStarted ?? null;
	out.dateFinished = e.dateFinished ?? null;
	out.releaseDate = e.releaseDate ?? null;
	out.dateAdded = e.dateAdded;
	out.dateModified = e.dateModified;
	// a cover only in the cache is the API's; one from the note is the user's (E9)
	if (e.coverOverride && e.coverUrl) out.coverUrl = e.coverUrl;
	if (e.externalLink) out.externalLink = e.externalLink;
	if (e.groups?.length) out.groups = [...e.groups];
	encodeAirtime(e.airtime, out);
	for (const [k, v] of Object.entries(e.customFields ?? {})) out[`cf_${k}`] = v;
	out.type = kind;
}

export function decodeBook(id: string, fm: Fm): Decoded<Book> {
	const r = new FmReader(fm);
	const ext = parseExternalId(r.str('externalId'));
	const gbooks = ext?.source === 'gbooks' ? ext.id : '';
	const entry: Book = {
		id,
		title: r.str('title'),
		author: r.str('author'),
		status: status(r),
		favorite: r.bool('favorite') || undefined,
		dateFavorited: r.strOrNull('dateFavorited') ?? undefined,
		rating: r.num('rating'),
		progressUnit: r.str('progressUnit') === 'words' ? 'words' : 'pages',
		pagesRead: r.num('pagesRead'),
		totalPages: r.num('totalPages'),
		wordsRead: r.num('wordsRead'),
		totalWords: r.num('totalWords'),
		chaptersRead: r.num('chaptersRead'),
		totalChapters: r.num('totalChapters'),
		coverUrl: r.str('coverUrl'),
		googleBooksId: r.str('googleBooksId') || gbooks,
		externalLink: r.strOrNull('externalLink') ?? undefined,
		vaultPage: `${id}.md`,
		dateStarted: r.strOrNull('dateStarted'),
		dateFinished: r.strOrNull('dateFinished'),
		releaseDate: r.strOrNull('releaseDate'),
		dateAdded: r.str('dateAdded'),
		dateModified: r.str('dateModified'),
		customFields: decodeCustomFields(r),
		groups: r.list('groups'),
		airtime: decodeAirtime(r),
	};
	if (entry.coverUrl) entry.coverOverride = true;
	if (!entry.favorite) delete entry.favorite;
	if (!entry.dateFavorited) delete entry.dateFavorited;
	if (!entry.externalLink) delete entry.externalLink;
	if (!entry.groups?.length) delete entry.groups;
	if (!entry.airtime) delete entry.airtime;
	return { entry, invalidFields: r.invalidFields };
}

export function encodeBook(b: Book): Fm {
	const out: Fm = {};
	encodeCommon(b, out);
	out.pagesRead = b.pagesRead | 0;
	out.totalPages = b.totalPages | 0;
	// words are opt-in: emitted only when they carry meaning
	if (b.progressUnit === 'words' || (b.wordsRead | 0) > 0 || (b.totalWords | 0) > 0) {
		out.progressUnit = b.progressUnit === 'words' ? 'words' : 'pages';
		out.wordsRead = b.wordsRead | 0;
		out.totalWords = b.totalWords | 0;
	}
	out.chaptersRead = b.chaptersRead | 0;
	out.totalChapters = b.totalChapters | 0;
	if (b.googleBooksId) {
		out.googleBooksId = b.googleBooksId;
		out.externalId = formatExternalId({ source: 'gbooks', id: b.googleBooksId });
	}
	encodeTail(b, 'book', out);
	return out;
}

export function decodeManga(id: string, fm: Fm): Decoded<Manga> {
	const r = new FmReader(fm);
	const ext = parseExternalId(r.str('externalId'));
	const mal = ext?.source === 'mal' && ext.kind === 'manga' ? ext.id : '';
	const entry: Manga = {
		id,
		title: r.str('title'),
		author: r.str('author'),
		status: status(r),
		favorite: r.bool('favorite') || undefined,
		dateFavorited: r.strOrNull('dateFavorited') ?? undefined,
		rating: r.num('rating'),
		chaptersRead: r.num('chaptersRead'),
		totalChapters: r.num('totalChapters'),
		volumesRead: r.num('volumesRead'),
		totalVolumes: r.num('totalVolumes'),
		coverUrl: r.str('coverUrl'),
		malId: r.str('malId') || mal,
		externalLink: r.strOrNull('externalLink') ?? undefined,
		vaultPage: `${id}.md`,
		dateStarted: r.strOrNull('dateStarted'),
		dateFinished: r.strOrNull('dateFinished'),
		releaseDate: r.strOrNull('releaseDate'),
		dateAdded: r.str('dateAdded'),
		dateModified: r.str('dateModified'),
		customFields: decodeCustomFields(r),
		groups: r.list('groups'),
		airtime: decodeAirtime(r),
	};
	if (entry.coverUrl) entry.coverOverride = true;
	if (!entry.favorite) delete entry.favorite;
	if (!entry.dateFavorited) delete entry.dateFavorited;
	if (!entry.externalLink) delete entry.externalLink;
	if (!entry.groups?.length) delete entry.groups;
	if (!entry.airtime) delete entry.airtime;
	return { entry, invalidFields: r.invalidFields };
}

export function encodeManga(m: Manga): Fm {
	const out: Fm = {};
	encodeCommon(m, out);
	out.chaptersRead = m.chaptersRead | 0;
	out.totalChapters = m.totalChapters | 0;
	out.volumesRead = m.volumesRead | 0;
	out.totalVolumes = m.totalVolumes | 0;
	if (m.malId) {
		out.malId = m.malId;
		out.externalId = formatExternalId({ source: 'mal', kind: 'manga', id: m.malId });
	}
	encodeTail(m, 'manga', out);
	return out;
}

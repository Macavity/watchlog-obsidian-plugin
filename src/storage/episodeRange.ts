import type { Season } from '../types';
import type { EpisodeRef } from './storageTypes';

// S01E01, s1e1, S01E01-E12 (same season), S01E11-S02E02 (cross-season, needs seasons)
const TOKEN = /^s(\d+)e(\d+)(?:-(?:s(\d+))?e(\d+))?$/i;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Upper bound for any episode number; guards range expansion against absurd input. */
export const MAX_EPISODE = 10_000;

/** Episode number within bounds: ≤ MAX_EPISODE, and ≤ the season's count when that season is known. */
function inBounds(season: number, episode: number, seasons?: Season[]): boolean {
	if (episode > MAX_EPISODE) return false;
	const known = seasons?.[season - 1];
	return !known || episode <= known.episodes;
}

/** Sorts and dedupes refs. */
function normalize(refs: EpisodeRef[]): EpisodeRef[] {
	const sorted = [...refs].sort((a, b) => a.season - b.season || a.episode - b.episode);
	const out: EpisodeRef[] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (!last || last.season !== r.season || last.episode !== r.episode) out.push(r);
	}
	return out;
}

/** Absolute episode number (1-based across all seasons), or undefined if out of range. */
function absOf(ref: EpisodeRef, seasons: Season[]): number | undefined {
	const season = seasons[ref.season - 1];
	if (!season || ref.episode < 1 || ref.episode > season.episodes) return undefined;
	const before = seasons.slice(0, ref.season - 1).reduce((sum, s) => sum + s.episodes, 0);
	return before + ref.episode;
}

/**
 * Parses "S01E01-E12, S02E05" into refs. Returns null on garbage, out-of-bounds episode numbers or
 * cross-season ranges without seasons. Seasons beyond the given list are not checked.
 */
export function parseEpisodeRange(input: string, seasons?: Season[]): EpisodeRef[] | null {
	const out: EpisodeRef[] = [];
	for (const part of input.split(',').map((p) => p.trim()).filter(Boolean)) {
		const m = part.match(TOKEN);
		if (!m || m[1] === undefined || m[2] === undefined) return null;
		const season = parseInt(m[1], 10);
		const from = parseInt(m[2], 10);
		if (!inBounds(season, from, seasons)) return null;
		if (m[4] === undefined) {
			out.push({ season, episode: from });
			continue;
		}
		const to = parseInt(m[4], 10);
		const endSeason = m[3] === undefined ? season : parseInt(m[3], 10);
		if (!inBounds(endSeason, to, seasons)) return null;
		if (endSeason === season) {
			if (from > to) return null;
			for (let e = from; e <= to; e++) out.push({ season, episode: e });
			continue;
		}
		if (!seasons) return null;
		const a = absOf({ season, episode: from }, seasons);
		const b = absOf({ season: endSeason, episode: to }, seasons);
		if (a === undefined || b === undefined || a > b) return null;
		out.push(...fromAbsolute(Array.from({ length: b - a + 1 }, (_, k) => a + k), seasons));
	}
	return normalize(out);
}

/** Formats refs canonically: sorted, deduped, consecutive runs per season collapsed. */
export function formatEpisodeRange(refs: EpisodeRef[]): string {
	const runs: string[] = [];
	let runStart: EpisodeRef | undefined;
	let prev: EpisodeRef | undefined;
	const flush = (): void => {
		if (!runStart || !prev) return;
		const head = `S${pad(runStart.season)}E${pad(runStart.episode)}`;
		runs.push(runStart.episode === prev.episode ? head : `${head}-E${pad(prev.episode)}`);
	};
	for (const r of normalize(refs)) {
		if (prev && prev.season === r.season && prev.episode + 1 === r.episode) {
			prev = r;
			continue;
		}
		flush();
		runStart = r;
		prev = r;
	}
	flush();
	return runs.join(', ');
}

/** Refs whose season is not in the list (S02 while only S01 is known). */
export function outsideSeasons(refs: EpisodeRef[], seasons: Season[]): EpisodeRef[] {
	return refs.filter((r) => !seasons[r.season - 1]);
}

/** Maps refs to absolute episode numbers; refs outside the known seasons are dropped. */
export function toAbsolute(refs: EpisodeRef[], seasons: Season[]): number[] {
	const nums = refs.map((r) => absOf(r, seasons)).filter((n): n is number => n !== undefined);
	return [...new Set(nums)].sort((a, b) => a - b);
}

/** Maps absolute episode numbers back to refs; numbers outside the known seasons are dropped. */
export function fromAbsolute(nums: number[], seasons: Season[]): EpisodeRef[] {
	const out: EpisodeRef[] = [];
	for (const n of [...new Set(nums)].sort((a, b) => a - b)) {
		let before = 0;
		seasons.forEach((s, i) => {
			if (n > before && n <= before + s.episodes) out.push({ season: i + 1, episode: n - before });
			before += s.episodes;
		});
	}
	return out;
}

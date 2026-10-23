/** Priority names, highest first; anything else (empty) sorts last. */
export const PRIORITY_ORDER = ['High', 'Medium', 'Low'] as const;

/** Fisher–Yates on a copy, returning the first `count` items. */
export function pickRandom<T>(pool: T[], count: number): T[] {
	const arr = [...pool];
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = arr[i]!;
		arr[i] = arr[j]!;
		arr[j] = tmp;
	}
	return arr.slice(0, count);
}

/**
 * Compares two numbers where 0 means "not set": unset always sorts after every real value,
 * whatever the direction (un-rated stays below every rating, untracked below every playtime).
 */
export function compareUnsetLast(a: number, b: number, dir: 'asc' | 'desc'): number {
	if (a === 0 && b === 0) return 0;
	if (a === 0) return 1;
	if (b === 0) return -1;
	return dir === 'asc' ? a - b : b - a;
}

/** High → Low, empty last; direction-agnostic. */
export function comparePriority(a: string, b: string): number {
	const ai = PRIORITY_ORDER.indexOf(a as typeof PRIORITY_ORDER[number]);
	const bi = PRIORITY_ORDER.indexOf(b as typeof PRIORITY_ORDER[number]);
	return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
}

/** Released within the last 7 days (the Watchlist "Recently arrived" rule). */
export function isRecentlyReleased(releaseDate: string | null): boolean {
	if (!releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return false;
	const releaseMs = new Date(releaseDate + 'T00:00:00').getTime();
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const diffDays = (today.getTime() - releaseMs) / 86400000;
	return diffDays >= 0 && diffDays <= 7;
}

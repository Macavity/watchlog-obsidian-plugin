import type { HistoryAction, HistorySource } from '../HistoryManager';

export type HistoryLineAction = HistoryAction | 'group-created';

export interface HistoryLine {
	timestamp: string;
	action: HistoryLineAction;
	target: string;
	isLink: boolean;
	message?: string;
	source?: HistorySource;
}

const SEP = ' · ';
const ACTIONS: readonly HistoryLineAction[] = ['added', 'completed', 'deleted', 'status', 'rating', 'watched', 'group-created'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SOURCES: Record<string, HistorySource> = { watchlist: 'Watchlist', reading: 'Reading', games: 'Games' };

/** Parses "- <ISO> · <action> · <target> · <message> #source". Returns null for non-matching lines. */
export function parseHistoryLine(line: string): HistoryLine | null {
	if (!line.startsWith('- ')) return null;
	const body = line.slice(2);
	const tsEnd = body.indexOf(SEP);
	if (tsEnd < 0) return null;
	const timestamp = body.slice(0, tsEnd);
	if (!ISO.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return null;

	const rest1 = body.slice(tsEnd + SEP.length);
	const actEnd = rest1.indexOf(SEP);
	if (actEnd < 0) return null;
	const action = rest1.slice(0, actEnd);
	if (!(ACTIONS as readonly string[]).includes(action)) return null;

	let rest = rest1.slice(actEnd + SEP.length);
	let target: string;
	let isLink = false;
	const link = /^\[\[(.+?)\]\]/.exec(rest);
	if (link) {
		target = link[1] ?? '';
		isLink = true;
		rest = rest.slice(link[0].length);
		if (rest !== '' && !rest.startsWith(SEP)) return null;
		rest = rest.slice(SEP.length);
	} else {
		const tEnd = rest.indexOf(SEP);
		target = tEnd < 0 ? rest : rest.slice(0, tEnd);
		rest = tEnd < 0 ? '' : rest.slice(tEnd + SEP.length);
	}
	if (!target) return null;

	const out: HistoryLine = { timestamp, action: action as HistoryLineAction, target, isLink };
	const src = /(?:^|\s)#(watchlist|reading|games)$/.exec(rest);
	if (src) {
		out.source = SOURCES[src[1] ?? ''];
		rest = rest.slice(0, src.index);
	}
	const message = rest.trim();
	if (message) out.message = message;
	return out;
}

/** Inverse of parseHistoryLine. */
export function formatHistoryLine(l: HistoryLine): string {
	const parts = [`- ${l.timestamp}`, l.action, l.isLink ? `[[${l.target}]]` : l.target];
	const msg = [l.message ?? '', l.source ? `#${l.source.toLowerCase()}` : ''].filter(Boolean).join(' ');
	if (msg) parts.push(msg);
	return parts.join(SEP);
}

import Fuse from 'fuse.js';

/**
 * One searchable field. `text` feeds the fuzzy index, `number` feeds range tokens; a field may
 * carry either or both (year is both — bare "2020" is text, `year:>2020` is numeric).
 */
export interface SearchFieldSpec<T> {
	/** Canonical name, and the `field:` prefix users type. */
	name: string;
	/** Shown in the help modal. */
	label: string;
	/** Fuse weight; omit for numeric-only fields. */
	weight?: number;
	/** Extra accepted prefixes (dev → developer). */
	aliases?: string[];
	text?: (item: T) => string[];
	number?: (item: T) => number | null;
}

export interface SearchConfig<T> {
	id: (item: T) => string;
	fields: SearchFieldSpec<T>[];
}

type Comparator = '>' | '>=' | '<' | '<=' | '=';

interface Token {
	negated: boolean;
	/** Canonical field name, or null for "any field". */
	field: string | null;
	text: string;
	/** Quoted — exact substring, never fuzzy. */
	exact: boolean;
	/** Set when the value parsed as a numeric comparison. */
	compare: { op: Comparator; value: number } | null;
	/** Followed a `|` — ORs into the previous token instead of ANDing. */
	alternate: boolean;
}

// 0.24, not 0.25: Fuse's threshold is inclusive and 0.25 admits 2-edit fuzz
// ("avengers" -> "Passengers", 2/8 = 0.25)
const FUZZ_THRESHOLD = 0.24;

/** `-`, optional `field:`, then a "quoted phrase" or a bare run. */
const TOKEN_RE = /(-?)(?:([A-Za-z_][\w-]*):)?(?:"([^"]*)"|(\S+))/g;

const COMPARE_RE = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/;

/** Isolates `|` so `a|b` tokenizes the same as `a | b`. Pipes inside quotes stay literal. */
function spaceOutPipes(query: string): string {
	let out = '';
	let inQuotes = false;
	for (const ch of query) {
		if (ch === '"') inQuotes = !inQuotes;
		if (ch === '|' && !inQuotes) { out += ' | '; continue; }
		out += ch;
	}
	return out;
}

function parseCompare(raw: string): { op: Comparator; value: number } | null {
	const m = COMPARE_RE.exec(raw.trim());
	if (!m) return null;
	return { op: (m[1] as Comparator) ?? '=', value: Number(m[2]) };
}

/**
 * Splits a raw query into tokens. Unknown `field:` prefixes are NOT treated as fields — "Re:Zero"
 * must stay a plain search, so the prefix only counts when it names a real field.
 */
export function parseQuery<T>(query: string, fields: SearchFieldSpec<T>[]): Token[] {
	const canonical = new Map<string, string>();
	for (const f of fields) {
		canonical.set(f.name.toLowerCase(), f.name);
		for (const a of f.aliases ?? []) canonical.set(a.toLowerCase(), f.name);
	}

	const tokens: Token[] = [];
	TOKEN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	// a bare `|` does not become a token — it flags the next one as an alternative
	let pendingOr = false;
	while ((m = TOKEN_RE.exec(spaceOutPipes(query))) !== null) {
		const prefix = m[2];
		const quoted = m[3];
		const bare = m[4];
		const field = prefix ? canonical.get(prefix.toLowerCase()) ?? null : null;
		// unknown prefix — fold it back into the text so "Re:Zero" still searches
		let text = quoted !== undefined ? quoted : bare ?? '';
		if (prefix && !field) text = `${prefix}:${text}`;
		if (!text) continue;
		if (quoted === undefined && text === '|') {
			// dangling leading `|` has nothing to join
			pendingOr = tokens.length > 0;
			continue;
		}
		tokens.push({
			negated: m[1] === '-',
			field,
			text,
			exact: quoted !== undefined,
			compare: quoted !== undefined ? null : parseCompare(text),
			alternate: pendingOr,
		});
		pendingOr = false;
	}
	return tokens;
}

/** Field names a token is allowed to consult. */
function scopeOf<T>(token: Token, fields: SearchFieldSpec<T>[]): SearchFieldSpec<T>[] {
	return token.field ? fields.filter((f) => f.name === token.field) : fields;
}

/**
 * Runs one query over `items`, returning matching ids — or null for an empty query, the shared
 * "no search active" signal the tabs already use.
 *
 * Semantics: bare tokens fuzzy-match and are ANDed **across** fields (so a cast word plus a studio
 * word can match one item between them), quoted tokens are exact substrings, `field:value` scopes to
 * one field, `field:>n` compares numerically, `a | b` matches either, and `-token` excludes.
 *
 * The cross-field AND is deliberate and has a known cost: unquoted "christopher nolan" also matches
 * an item with Christopher Plummer in the cast and Jane Nolan elsewhere. Quotes and `field:` are the
 * escape hatch. The previous same-field rule avoided that but made cross-field queries impossible.
 */
export function searchItems<T>(items: T[], config: SearchConfig<T>, query: string): Set<string> | null {
	const trimmed = query.trim();
	if (!trimmed) return null;

	const tokens = parseQuery(trimmed, config.fields);
	if (tokens.length === 0) return null;

	const textFields = config.fields.filter((f) => f.text);
	const records = items.map((item) => {
		const rec: Record<string, unknown> = { __id: config.id(item) };
		for (const f of textFields) rec[f.name] = f.text!(item);
		return rec;
	});

	// one index, reused by every token
	const fuse = new Fuse(records, {
		keys: textFields.map((f) => ({ name: f.name, weight: f.weight ?? 0.1 })),
		threshold: FUZZ_THRESHOLD,
		ignoreLocation: true,
		includeMatches: true,
	});

	const byId = new Map<string, T>();
	for (const item of items) byId.set(config.id(item), item);

	/** Ids matching one token, ignoring its negation. */
	const hits = (token: Token): Set<string> => {
		const scope = scopeOf(token, config.fields);
		const out = new Set<string>();

		// numeric comparison — no fuzz, only fields exposing a number
		if (token.compare && token.field) {
			const numeric = scope.filter((f) => f.number);
			if (numeric.length > 0) {
				const { op, value } = token.compare;
				for (const [id, item] of byId) {
					for (const f of numeric) {
						const n = f.number!(item);
						if (n === null) continue;
						const ok =
							op === '>' ? n > value :
							op === '>=' ? n >= value :
							op === '<' ? n < value :
							op === '<=' ? n <= value :
							n === value;
						if (ok) { out.add(id); break; }
					}
				}
				return out;
			}
		}

		// quoted — exact substring over the scoped fields
		if (token.exact) {
			const needle = token.text.toLowerCase();
			for (const [id, item] of byId) {
				for (const f of scope) {
					if (!f.text) continue;
					if (f.text(item).some((v) => v.toLowerCase().includes(needle))) { out.add(id); break; }
				}
			}
			return out;
		}

		// bare — fuzzy, restricted to the scoped fields when one was named
		const allowed = token.field ? new Set(scope.map((f) => f.name)) : null;
		for (const r of fuse.search(token.text)) {
			const id = (r.item as { __id: string }).__id;
			if (!allowed) { out.add(id); continue; }
			if ((r.matches ?? []).some((mm) => mm.key && allowed.has(mm.key))) out.add(id);
		}
		return out;
	};

	const positive = tokens.filter((t) => !t.negated);
	const negative = tokens.filter((t) => t.negated);

	// `|` chains fold into one group; groups are ANDed, tokens inside a group are ORed
	const groups: Token[][] = [];
	for (const token of positive) {
		const last = groups[groups.length - 1];
		if (token.alternate && last) last.push(token);
		else groups.push([token]);
	}

	let acc: Set<string> | null = null;
	for (const group of groups) {
		const h = new Set<string>();
		for (const token of group) for (const id of hits(token)) h.add(id);
		acc = acc === null ? h : new Set([...acc].filter((id) => h.has(id)));
		if (acc.size === 0) break;
	}
	// a query of only exclusions starts from everything
	if (acc === null) acc = new Set(byId.keys());

	for (const token of negative) {
		for (const id of hits(token)) acc.delete(id);
	}
	return acc;
}

/** Year from an ISO-ish date string, or null. */
export function yearOf(date: string | null | undefined): number | null {
	if (!date) return null;
	const y = Number(String(date).slice(0, 4));
	return Number.isFinite(y) && y > 0 ? y : null;
}

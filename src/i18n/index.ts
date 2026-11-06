import en from './en';
import de from './de';

type Leaf = string | { one: string; other: string; zero?: string };
// Leaf strings are widened: `as const` locale files hold literal types the translations must not have to match.
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type Params = Record<string, string | number>;

export type Paths<T, P extends string = ''> = {
	[K in keyof T & string]: T[K] extends string
		? `${P}${K}`
		: T[K] extends { readonly one: string; readonly other: string }
			? `${P}${K}`
			: Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TranslationKey = Paths<typeof en>;

const registry: Record<string, object> = { en, de };
const flatCache = new Map<string, Map<string, Leaf>>();

let chain: Map<string, Leaf>[] = [];
let locale = 'en';
let rules = new Intl.PluralRules('en');

function isPlural(v: unknown): v is Exclude<Leaf, string> {
	const o = v as { one?: unknown; other?: unknown };
	return typeof v === 'object' && v !== null && typeof o.one === 'string' && typeof o.other === 'string';
}

function flatten(node: object, prefix: string, out: Map<string, Leaf>): void {
	for (const [k, v] of Object.entries(node) as [string, unknown][]) {
		const path = prefix ? `${prefix}.${k}` : k;
		if (typeof v === 'string' || isPlural(v)) out.set(path, v);
		else if (typeof v === 'object' && v !== null) flatten(v, path, out);
	}
}

function flatFor(lang: string): Map<string, Leaf> {
	let map = flatCache.get(lang);
	if (!map) {
		map = new Map();
		flatten(registry[lang] as object, '', map);
		flatCache.set(lang, map);
	}
	return map;
}

export function setLocale(lang: string | undefined): void {
	const wanted = lang ? [lang, lang.split('-')[0] ?? '', 'en'] : ['en'];
	const langs = [...new Set(wanted)].filter((l) => l !== '' && Object.prototype.hasOwnProperty.call(registry, l));
	if (langs.length === 0) langs.push('en');
	chain = langs.map(flatFor);
	locale = langs[0] ?? 'en';
	rules = new Intl.PluralRules(locale);
}

export function getLocale(): string {
	return locale;
}

function pickForm(leaf: Leaf, params?: Params): string {
	if (typeof leaf === 'string') return leaf;
	const count = params?.count;
	if (typeof count !== 'number') return leaf.other;
	if (count === 0 && leaf.zero !== undefined) return leaf.zero;
	return leaf[rules.select(count) === 'one' ? 'one' : 'other'];
}

export function t(key: TranslationKey, params?: Params): string {
	if (chain.length === 0) setLocale('en');
	for (const map of chain) {
		const leaf = map.get(key);
		if (leaf === undefined) continue;
		const text = pickForm(leaf, params);
		if (!params) return text;
		return text.replace(/\{(\w+)\}/g, (m, name: string) => {
			const v = params[name];
			return v === undefined ? m : String(v);
		});
	}
	return key;
}

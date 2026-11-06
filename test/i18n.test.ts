import { describe, it, expect } from 'vitest';
import { setLocale, getLocale, t } from '../src/i18n';
import en from '../src/i18n/en';
import de from '../src/i18n/de';

type Plural = { one: string; other: string; zero?: string };
type Leaf = string | Plural;

function isPlural(v: unknown): v is Plural {
	const o = v as { one?: unknown; other?: unknown };
	return typeof v === 'object' && v !== null && typeof o.one === 'string' && typeof o.other === 'string';
}

function flatten(node: object, prefix = '', out = new Map<string, Leaf>()): Map<string, Leaf> {
	for (const [k, v] of Object.entries(node) as [string, unknown][]) {
		const path = prefix ? `${prefix}.${k}` : k;
		if (typeof v === 'string' || isPlural(v)) out.set(path, v);
		else if (typeof v === 'object' && v !== null) flatten(v, path, out);
	}
	return out;
}

const enLeaves = flatten(en);
const deLeaves = flatten(de);

function placeholders(s: string): string {
	return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');
}

function forms(leaf: Leaf): [string, string][] {
	return typeof leaf === 'string' ? [['', leaf]] : (Object.entries(leaf) as [string, string][]);
}

// Words that are identical in German (cognates, proper nouns, service/unit names). A de leaf may equal en
// only if every word outside {placeholders} is listed here; glyph-only templates such as '{a}: {b}' pass.
const IDENTICAL_WORDS = new Set([
	'Anime', 'Manga', 'Watchlog', 'Steam', 'Vault', 'Backup', 'OK', 'CSV', 'ISO', 'JST', 'px', 'API',
	'Status', 'Genre', 'Name', 'Studio', 'Studios', 'Text', 'Option', 'Auto', 'Filter', 'Optional', 'Animation',
	'Dashboard', 'Watchlist', 'Widgets', 'Desktop', 'Tracker', 'Trailer', 'Details', 'Link', 'Links', 'Store', 'Cover',
	'Publisher', 'Solo', 'Multi', 'App', 'In', 'Release',
	// month names/abbreviations spelled the same in German
	'April', 'August', 'September', 'November', 'Jan', 'Feb', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Nov',
]);

function isAllowedIdentical(text: string): boolean {
	return text.replace(/\{\w+\}/g, ' ').split(/[^\p{L}]+/u).filter(Boolean).every((w) => IDENTICAL_WORDS.has(w));
}

describe('i18n', () => {
	it('resolves de-AT → de → en and unknown → en', () => {
		setLocale('de-AT'); expect(getLocale()).toBe('de'); expect(t('common.cancel')).toBe('Abbrechen');
		setLocale('xx'); expect(getLocale()).toBe('en'); expect(t('common.cancel')).toBe('Cancel');
		setLocale(undefined); expect(getLocale()).toBe('en');
	});
	it('interpolates and keeps unknown placeholders', () => {
		setLocale('en');
		expect(t('notices.manager.invalidYaml', { file: 'A.md' })).toBe(en.notices.manager.invalidYaml.replace('{file}', 'A.md'));
		expect(t('notices.manager.invalidYaml')).toBe(en.notices.manager.invalidYaml);
	});
	it('selects plural forms per locale', () => {
		setLocale('en');
		expect(t('app.statusBar.due', { count: 1 })).toBe('1 due');
		setLocale('de');
		const due = deLeaves.get('app.statusBar.due') as Plural;
		expect(t('app.statusBar.due', { count: 1 })).toBe(due.one.replace('{count}', '1'));
		expect(t('app.statusBar.due', { count: 3 })).toBe(due.other.replace('{count}', '3'));
		setLocale('en');
	});
	it('resolves leaves in a group that has an other key', () => {
		setLocale('en');
		expect(t('notices.api.auth.tmdb')).toBe(en.notices.api.auth.tmdb);
		setLocale('en');
	});
	it('never throws: missing key returns the key, plural without count uses other', () => {
		expect(t('nope.nothing' as never)).toBe('nope.nothing');
		setLocale('en'); expect(t('app.statusBar.due')).toBe('{count} due');
	});
	it('every en leaf exists in de with the same shape', () => {
		const missing: string[] = [];
		for (const [path, enLeaf] of enLeaves) {
			const deLeaf = deLeaves.get(path);
			if (deLeaf === undefined) { missing.push(`${path} (missing)`); continue; }
			if (typeof enLeaf === 'string' && typeof deLeaf !== 'string') missing.push(`${path} (should be string)`);
			else if (typeof enLeaf !== 'string' && (typeof deLeaf === 'string' || typeof deLeaf.one !== 'string' || typeof deLeaf.other !== 'string')) missing.push(`${path} (should be plural with one/other)`);
		}
		expect(missing).toEqual([]);
	});
	it('no de leaf without an en counterpart', () => {
		expect([...deLeaves.keys()].filter((p) => !enLeaves.has(p))).toEqual([]);
	});
	it('placeholders match between en and de', () => {
		const bad: string[] = [];
		for (const [path, enLeaf] of enLeaves) {
			const deLeaf = deLeaves.get(path);
			if (deLeaf === undefined) continue;
			const deForms = new Map(forms(deLeaf));
			for (const [form, text] of forms(enLeaf)) {
				const other = deForms.get(form);
				if (other === undefined) { if (form !== 'zero') bad.push(`${path}${form && '.' + form} (form missing)`); continue; }
				if (placeholders(text) !== placeholders(other)) bad.push(`${path}${form && '.' + form}: {${placeholders(text)}} vs {${placeholders(other)}}`);
			}
		}
		expect(bad).toEqual([]);
	});
	it('de leaves differ from en unless allowlisted', () => {
		const same: string[] = [];
		for (const [path, enLeaf] of enLeaves) {
			const deLeaf = deLeaves.get(path);
			if (deLeaf === undefined) continue;
			const deForms = new Map(forms(deLeaf));
			for (const [form, text] of forms(enLeaf)) {
				if (deForms.get(form) === text && !isAllowedIdentical(text)) same.push(`${path}${form && '.' + form}: ${text}`);
			}
		}
		expect(same).toEqual([]);
	});
});

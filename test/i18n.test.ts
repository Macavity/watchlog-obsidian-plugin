import { describe, it, expect } from 'vitest';
import { setLocale, getLocale, t } from '../src/i18n';
import en from '../src/i18n/en';
import de from '../src/i18n/de';

function isPlural(v: unknown): boolean {
	return typeof v === 'object' && v !== null && 'other' in v && typeof (v as { other: unknown }).other === 'string';
}

function walk(deNode: object, enNode: object, path: string[] = []): void {
	for (const [k, deVal] of Object.entries(deNode)) {
		const p = [...path, k];
		const enVal = (enNode as Record<string, unknown>)[k];
		expect(enVal, p.join('.')).toBeDefined();
		if (isPlural(deVal)) {
			expect(isPlural(enVal), `${p.join('.')} plural shape`).toBe(true);
		} else if (typeof deVal === 'object' && deVal !== null) {
			expect(typeof enVal, p.join('.')).toBe('object');
			walk(deVal, enVal as object, p);
		} else {
			expect(typeof enVal, p.join('.')).toBe(typeof deVal);
		}
	}
}

describe('i18n', () => {
	it('resolves de-AT → de → en and unknown → en', () => {
		setLocale('de-AT'); expect(getLocale()).toBe('de'); expect(t('common.cancel')).toBe('Abbrechen');
		setLocale('xx'); expect(getLocale()).toBe('en'); expect(t('common.cancel')).toBe('Cancel');
		setLocale(undefined); expect(getLocale()).toBe('en');
	});
	it('falls back per key to en when de lacks the leaf', () => {
		setLocale('de'); expect(t('common.testOnlyEnglish')).toBe(en.common.testOnlyEnglish);
	});
	it('interpolates and keeps unknown placeholders', () => {
		setLocale('en'); expect(t('common.testGreeting', { name: 'Ada' })).toBe('Hello Ada');
		expect(t('common.testGreeting')).toBe('Hello {name}');
	});
	it('selects plural forms per locale', () => {
		setLocale('en'); expect(t('common.testRows', { count: 1 })).toBe('1 row'); expect(t('common.testRows', { count: 2 })).toBe('2 rows');
		setLocale('de'); expect(t('common.testRows', { count: 1 })).toBe('1 Zeile'); expect(t('common.testRows', { count: 0 })).toBe('0 Zeilen');
	});
	it('never throws: missing key returns the key, plural without count uses other', () => {
		expect(t('nope.nothing' as never)).toBe('nope.nothing');
		setLocale('en'); expect(t('common.testRows')).toBe('{count} rows');
	});
	it('every de leaf exists in en with the same leaf shape', () => {
		walk(de, en);
	});
});

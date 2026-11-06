import { describe, it, expect, afterEach } from 'vitest';
import { setLocale } from '../src/i18n';
import en from '../src/i18n/en';
import de from '../src/i18n/de';
import { statusLabel, typeLabel, readingStatusLabel, gameStatusLabel, priorityLabel } from '../src/i18n/labels';
import { READING_STATUSES, defaultGamesSettings, DEFAULT_SETTINGS } from '../src/types';

describe('display labels', () => {
	afterEach(() => setLocale('en'));

	it('translates stored values in de', () => {
		setLocale('de');
		expect(statusLabel('Watching')).toBe(de.labels.status.Watching);
		expect(typeLabel('TV Show')).toBe(de.labels.type['TV Show']);
		expect(readingStatusLabel('Plan to Read')).toBe(de.labels.readingStatus['Plan to Read']);
		expect(statusLabel('Watching')).not.toBe('Watching');
	});

	it('returns unknown values unchanged', () => {
		setLocale('de');
		expect(statusLabel('My custom')).toBe('My custom');
		expect(typeLabel('Documentary')).toBe('Documentary');
	});

	it('en labels equal the stored values', () => {
		setLocale('en');
		for (const k of Object.keys(en.labels.status)) expect(statusLabel(k)).toBe(k);
		for (const k of Object.keys(en.labels.type)) expect(typeLabel(k)).toBe(k);
		for (const k of Object.keys(en.labels.readingStatus)) {
			expect(readingStatusLabel(k as (typeof READING_STATUSES)[number])).toBe(k);
		}
	});

	it('covers every reading status', () => {
		for (const s of READING_STATUSES) expect(en.labels.readingStatus).toHaveProperty(s);
	});

	it('translates game statuses and priorities in de', () => {
		setLocale('de');
		expect(gameStatusLabel('Playing')).toBe('Spiele');
		expect(gameStatusLabel('Not started')).toBe('Nicht begonnen');
		expect(gameStatusLabel('To be released')).toBe('Noch nicht erschienen');
		expect(priorityLabel('High')).toBe('Hoch');
		expect(priorityLabel('Medium')).toBe('Mittel');
		expect(priorityLabel('Low')).toBe('Niedrig');
	});

	it('passes unknown game statuses and priorities through, empty priority stays empty', () => {
		setLocale('de');
		expect(gameStatusLabel('Backlog')).toBe('Backlog');
		expect(priorityLabel('Urgent')).toBe('Urgent');
		expect(priorityLabel('')).toBe('');
	});

	it('en game status and priority labels equal their keys', () => {
		setLocale('en');
		for (const k of Object.keys(en.labels.gameStatus)) expect(gameStatusLabel(k)).toBe(k);
		for (const k of Object.keys(en.labels.priority)) expect(priorityLabel(k)).toBe(k);
	});

	it('covers every default game status and priority', () => {
		for (const s of defaultGamesSettings().statuses) expect(en.labels.gameStatus).toHaveProperty(s.name);
		for (const p of DEFAULT_SETTINGS.priorities) expect(en.labels.priority).toHaveProperty(p.name);
	});
});

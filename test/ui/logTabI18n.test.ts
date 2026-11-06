import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import { actionLabel } from '../../src/LogTab';
import type { HistoryEntry } from '../../src/HistoryManager';

afterEach(() => {
	setLocale('en');
});

function entry(message: string): HistoryEntry {
	return { id: '1', timestamp: '2026-11-06T10:00:00.000Z', message };
}

describe('log tab status labels', () => {
	it('shows the stored watch status in the UI language', () => {
		setLocale('de');
		const label = actionLabel(entry('"Foo" status changed to Watching'));
		expect(label).toContain('Schaue');
		expect(label).not.toContain('Watching');
	});

	it('shows reading statuses and passes custom statuses through', () => {
		setLocale('de');
		expect(actionLabel(entry('"Bar" status changed to Plan to Read'))).toContain('Geplant');
		expect(actionLabel(entry('"Baz" status changed to My custom'))).toContain('My custom');
	});
});

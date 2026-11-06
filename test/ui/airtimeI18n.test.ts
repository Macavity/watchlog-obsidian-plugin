import { afterEach, describe, expect, it } from 'vitest';
import { Platform } from 'obsidian';
import { setLocale } from '../../src/i18n';
import { formatDaysWithMonths, getDetailedCountdown } from '../../src/AirtimeTab';
import { renderToolbarWithMobileToggle } from '../../src/MobileToolbar';
import { El } from '../helpers/fakeEl';

afterEach(() => {
	setLocale('en');
	(Platform as { isMobile: boolean }).isMobile = false;
});

const dayOffset = (days: number): string => {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('airtime countdown i18n', () => {
	it('formats day counts per locale', () => {
		expect(formatDaysWithMonths(3)).toBe('in 3 days');
		expect(formatDaysWithMonths(65)).toBe('in 65 days (2 months)');
		setLocale('de');
		expect(formatDaysWithMonths(3)).toBe('in 3 Tagen');
		expect(formatDaysWithMonths(65)).toBe('in 65 Tagen (2 Monate)');
	});

	it('labels tomorrow and a future date per locale', () => {
		const tomorrow = { recurrence: 'once' as const, releaseDate: dayOffset(1) };
		const later = { recurrence: 'once' as const, releaseDate: dayOffset(3) };
		expect(getDetailedCountdown(tomorrow, false).label).toBe('Tomorrow');
		expect(getDetailedCountdown(later, false).label).toBe('in 3 days');
		setLocale('de');
		expect(getDetailedCountdown(tomorrow, false).label).toBe('Morgen');
		expect(getDetailedCountdown(later, false).label).toBe('in 3 Tagen');
	});

	it('labels a daily show before airtime as today per locale', () => {
		const daily = { recurrence: 'daily' as const, releaseTime: '23:59' };
		const at = new Date();
		if (at.getHours() === 23 && at.getMinutes() === 59) return;
		expect(getDetailedCountdown(daily, false).label).toBe('Today');
		setLocale('de');
		expect(getDetailedCountdown(daily, false).label).toBe('Heute');
	});
});

describe('mobile toolbar i18n', () => {
	it('renders the toggle label in the active locale', () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		setLocale('de');
		const controls = new El('root');
		renderToolbarWithMobileToggle({
			controls: controls as unknown as HTMLElement,
			renderSearch: () => {},
			renderActions: () => {},
			renderAdd: (p) => (p as unknown as El).createEl('button', { text: '+ add' }) as unknown as HTMLButtonElement,
			expanded: false,
			onToggleChange: () => {},
		});
		const toggle = controls.children.find((c) => c.classes.has('wl-toolbar-toggle-btn'))!;
		expect(toggle.attr['aria-label']).toBe('Filter und Aktionen anzeigen');
	});
});

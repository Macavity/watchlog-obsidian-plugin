import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import de from '../../src/i18n/de';
import { apiErrorMessage, apiErrorShort } from '../../src/ApiService';
import { renderBatchStatusSelect } from '../../src/ui/ActionBar';
import { nameSelect } from '../../src/ui/FormCells';
import { scheduleText } from '../../src/ui/scheduleText';
import { buildFilterSections, formatPriorityOpt, type CommonFilterDraft } from '../../src/ui/TabFilters';
import { statusLabel, typeLabel } from '../../src/i18n/labels';
import { parseBackup } from '../../src/backup';
import { ROWS_SHELVES } from '../../src/types';
import { El } from '../helpers/fakeEl';

afterEach(() => setLocale('en'));

const draft = (): CommonFilterDraft => ({
	statusExclude: new Set(), ratingExclude: new Set(), priorityExclude: new Set(), groupExclude: new Set(),
	filterRatingEmptyOnly: false, filterRecentlyArrivedOnly: false, filterGroupsOnly: false,
});

describe('stored-value dropdowns', () => {
	it('shows the German status in filters while the option stays the stored value', () => {
		setLocale('de');
		const sections = buildFilterSections({
			lead: [], statusOpts: ['Plan to watch'], formatStatus: statusLabel, ratingOpts: [], priorities: [],
			groupOpts: [], draft: draft(),
		});
		const status = sections.find((s) => s.opts.includes('Plan to watch'))!;
		expect(status.opts).toEqual(['Plan to watch']);
		expect(status.formatOpt?.('Plan to watch')).toBe(de.labels.status['Plan to watch']);
		expect(status.formatOpt?.('Plan to watch')).not.toBe('Plan to watch');
	});

	it('shows the German status in the batch select, value unchanged', () => {
		setLocale('de');
		const bar = new El('bar');
		renderBatchStatusSelect(bar as unknown as HTMLElement, ['Watching'], async () => {}, statusLabel);
		const options = bar.children[0]!.children;
		expect(options[1]!.value).toBe('Watching');
		expect(options[1]!.text).toBe(de.labels.status.Watching);
	});

	it('maps names through the display formatter in nameSelect', () => {
		setLocale('de');
		const parent = new El('root');
		nameSelect(parent as unknown as HTMLElement, ['Movie', 'Custom type'], 'Movie', () => {}, false, typeLabel);
		const options = parent.children[0]!.children;
		expect(options.map((o) => o.value)).toEqual(['Movie', 'Custom type']);
		expect(options[0]!.text).toBe(de.labels.type.Movie);
		expect(options[1]!.text).toBe('Custom type');
	});

	it('translates the empty priority option', () => {
		setLocale('de');
		expect(formatPriorityOpt('')).toBe(de.list.footer.noPriority);
		expect(formatPriorityOpt('High')).toBe('High');
	});
});

describe('schedule text', () => {
	it('renders a weekly schedule in German', () => {
		setLocale('de');
		expect(scheduleText({ recurrence: 'weekly', dayOfWeek: 1, releaseTime: '20:00' }))
			.toBe(`${de.ui.schedule.everyWeekday.replace('{day}', de.ui.schedule.days.monday)} · 20:00`);
	});

	it('renders English and the short lead of a single release', () => {
		expect(scheduleText({ recurrence: 'daily' })).toBe('Every day');
		expect(scheduleText({ recurrence: 'once' })).toBe('No date set');
		expect(scheduleText({ recurrence: 'once', releaseDate: '2026-07-25' }, 'Release')).toMatch(/^Release · \d/);
		expect(scheduleText({ recurrence: 'monthly', dayOfMonth: 3 })).toBe('Monthly on day 3');
	});
});

describe('api and backup messages', () => {
	it('localizes the generic API failure texts', () => {
		expect(apiErrorMessage(new Error('x'))).toBe('Request failed; check your connection.');
		expect(apiErrorShort(new Error('x'))).toBe('Failed');
		setLocale('de');
		expect(apiErrorMessage(new Error('x'))).toBe(de.notices.api.requestFailed);
		expect(apiErrorShort(new Error('x'))).toBe(de.notices.api.short.failed);
	});

	it('returns backup rejections as codes', () => {
		expect(parseBackup('nope')).toEqual({ error: 'parseJson' });
		expect(de.settings.backup.restore.errors.parseJson).toBeTruthy();
	});

	it('has a shelf label key for every shelf id', () => {
		for (const sh of ROWS_SHELVES) expect(de.list.shelves[sh.id as keyof typeof de.list.shelves]).toBeTruthy();
	});
});

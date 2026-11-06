import { t } from '../i18n';
import { getActiveDateFormat, isoParts, type AirtimeSchedule } from '../types';
import { dayName, monthShortName } from './dateNames';

/** `25 Jul 2026` / `Jul 25, 2026` / `2026-07-25` by the date format setting; non-ISO input passes through. */
function dateWithMonthName(dateStr: string): string {
	const p = isoParts(dateStr.slice(0, 10));
	if (!p) return dateStr;
	const fmt = getActiveDateFormat();
	if (fmt === 'iso') return `${p.y}-${p.m}-${p.d}`;
	const day = String(parseInt(p.d, 10));
	const mon = monthShortName(parseInt(p.m, 10) - 1);
	return fmt === 'american' ? `${mon} ${day}, ${p.y}` : `${day} ${mon} ${p.y}`;
}

/**
 * The schedule line of an Upcoming entry ("Every Monday · 20:00"). `releaseLead` replaces the
 * "Release date" lead of a single release (Cards use a shorter one).
 */
export function scheduleText(schedule: AirtimeSchedule, releaseLead = t('ui.schedule.releaseDate')): string {
	const time = schedule.releaseTime ? ` · ${schedule.releaseTime}` : '';
	switch (schedule.recurrence) {
		case 'once':
			if (!schedule.releaseDate) return t('ui.schedule.noDate');
			return `${releaseLead} · ${dateWithMonthName(schedule.releaseDate)}${time}`;
		case 'daily':
			return `${t('ui.schedule.everyDay')}${time}`;
		case 'weekly': {
			const day = schedule.dayOfWeek !== undefined && schedule.dayOfWeek >= 0 && schedule.dayOfWeek <= 6
				? dayName(schedule.dayOfWeek)
				: t('ui.schedule.unknown');
			return `${t('ui.schedule.everyWeekday', { day })}${time}`;
		}
		case 'monthly':
			return `${t('ui.schedule.monthlyOn', { day: schedule.dayOfMonth ?? '?' })}${time}`;
		default:
			return '—';
	}
}

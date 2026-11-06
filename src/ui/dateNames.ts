import { t, type TranslationKey } from '../i18n';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const MONTH_KEYS = [
	'january', 'february', 'march', 'april', 'may', 'june',
	'july', 'august', 'september', 'october', 'november', 'december',
] as const;

/** Localized weekday name; `index` follows Date.getDay() (Sunday first). */
export function dayName(index: number): string {
	return t(`ui.schedule.days.${DAY_KEYS[index] ?? 'sunday'}` as TranslationKey);
}

/** Localized month name; `index` follows Date.getMonth(). */
export function monthName(index: number): string {
	return t(`airtime.months.${MONTH_KEYS[index] ?? 'january'}` as TranslationKey);
}

/** Localized short month name (Jan, Feb, …); `index` follows Date.getMonth(). */
export function monthShortName(index: number): string {
	return t(`airtime.monthsShort.${MONTH_KEYS[index] ?? 'january'}` as TranslationKey);
}

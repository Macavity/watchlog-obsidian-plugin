import { t, type TranslationKey } from './index';
import en from './en';
import type { ReadingStatus } from '../types';

// Stored values are English and never change; these are the only place they become display text.
// Unknown (user-defined) values are returned unchanged.
function label(area: keyof typeof en.labels, value: string): string {
	if (!Object.prototype.hasOwnProperty.call(en.labels[area], value)) return value;
	return t(`labels.${area}.${value}` as TranslationKey);
}

export function statusLabel(status: string): string {
	return label('status', status);
}

export function typeLabel(type: string): string {
	return label('type', type);
}

export function readingStatusLabel(status: ReadingStatus): string {
	return label('readingStatus', status);
}

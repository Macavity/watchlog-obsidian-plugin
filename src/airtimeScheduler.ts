import type { AirtimeSchedule } from './types';
import type { DataManager } from './DataManager';
import type { ReadingDataManager } from './ReadingDataManager';
import type { GameDataManager } from './GameDataManager';

export interface AirtimeSchedulerDeps {
	dataManager: Pick<DataManager, 'getAirtimeEntries' | 'getTitle' | 'refreshAiring'>;
	readingDataManager: Pick<ReadingDataManager, 'getBook' | 'getManga'>;
	gameDataManager: Pick<GameDataManager, 'getGame'>;
	notify(name: string): void;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * One scheduler pass: notifies once per entry and day at its airing minute. Never writes a note;
 * recurring watch schedules get their API airing pointer refreshed (forced at the airing minute,
 * otherwise throttled by refreshAiring).
 */
export function runAirtimeScheduler(deps: AirtimeSchedulerDeps, notified: Set<string>, now = new Date()): void {
	const currentHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
	const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

	for (const entry of deps.dataManager.getAirtimeEntries()) {
		// only fire when the entry has a specific time set and it matches now; direct day check
		// avoids the getAirtimeCountdown rollover bug
		const due = entry.schedule.releaseTime === currentHHMM && isScheduledForToday(entry.schedule, now);
		const isWatch = entry.source !== 'reading' && entry.source !== 'game';
		if (isWatch && entry.schedule.recurrence !== 'once') void deps.dataManager.refreshAiring(entry.titleId, due);
		if (!due) continue;

		// deduplicate: only fire once per entry per day
		const notifKey = `${entry.id}-${today}`;
		if (notified.has(notifKey)) continue;
		notified.add(notifKey);

		// resolve the entry's subject — a watch title, a reading item, or a game
		let name: string | undefined;
		if (entry.source === 'game') {
			name = deps.gameDataManager.getGame(entry.titleId)?.title;
		} else if (entry.source === 'reading') {
			name = (entry.readingKind ?? 'book') === 'book'
				? deps.readingDataManager.getBook(entry.titleId)?.title
				: deps.readingDataManager.getManga(entry.titleId)?.title;
		} else {
			name = deps.dataManager.getTitle(entry.titleId)?.title;
		}
		if (name !== undefined) deps.notify(name);
	}
}

function isScheduledForToday(schedule: AirtimeSchedule, now: Date): boolean {
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	if (schedule.recurrence === 'daily') return true;

	if (schedule.recurrence === 'weekly') {
		return schedule.dayOfWeek === now.getDay();
	}

	if (schedule.recurrence === 'monthly') {
		return now.getDate() === (schedule.dayOfMonth ?? -1);
	}

	if (schedule.recurrence === 'once' && schedule.releaseDate) {
		const rel = new Date(schedule.releaseDate + 'T00:00:00');
		const relDay = new Date(rel.getFullYear(), rel.getMonth(), rel.getDate());
		return relDay.getTime() === today.getTime();
	}

	return false;
}

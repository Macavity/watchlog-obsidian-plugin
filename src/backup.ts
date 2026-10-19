import type { DataManager } from './DataManager';
import type { ReadingDataManager } from './ReadingDataManager';
import type { GameDataManager } from './GameDataManager';
import type { HistoryEntry, HistoryManager } from './HistoryManager';
import type { GamesData, MaybeTitle, ReadingData, WatchLogTitle } from './types';

export interface BackupManagers {
	dataManager: DataManager;
	readingDataManager: ReadingDataManager;
	gameDataManager: GameDataManager;
	historyManager: HistoryManager;
}

/** JSON backup. `shared` is the base config; API keys and device-local data are never included. */
export interface BackupFile {
	version: 2;
	exportedAt: string;
	entries: {
		titles: WatchLogTitle[];
		maybe: MaybeTitle[];
		reading: ReadingData;
		games: GamesData;
	};
	shared: Record<string, unknown>;
	history: HistoryEntry[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function buildBackup(m: BackupManagers): BackupFile {
	return {
		version: 2,
		exportedAt: new Date().toISOString(),
		entries: {
			titles: m.dataManager.getTitles(),
			maybe: m.dataManager.getMaybeTitles(),
			reading: m.readingDataManager.exportSnapshot(),
			games: m.gameDataManager.exportSnapshot(),
		},
		shared: m.dataManager.getSharedSettings(),
		history: m.historyManager.exportEntries(),
	};
}

/** Validates the whole file before anything is written. */
export function parseBackup(text: string): { backup: BackupFile } | { error: string } {
	let parsed: unknown;
	try { parsed = JSON.parse(text); } catch { return { error: 'could not parse JSON.' }; }
	if (!isRecord(parsed)) return { error: 'not an object.' };
	if (parsed['version'] !== 2 || !isRecord(parsed['entries'])) {
		return { error: 'unsupported format (expected a version 2 backup).' };
	}
	const e = parsed['entries'];
	const reading = e['reading'];
	const games = e['games'];
	if (!Array.isArray(e['titles']) || !Array.isArray(e['maybe'])) return { error: 'titles are missing.' };
	if (!isRecord(reading) || !Array.isArray(reading['books']) || !Array.isArray(reading['manga'])) {
		return { error: 'reading data is missing books or manga.' };
	}
	if (!isRecord(games) || !Array.isArray(games['games']) || !isRecord(games['settings'])) {
		return { error: 'games data is missing games or settings.' };
	}
	if (!isRecord(parsed['shared'])) return { error: 'shared settings are missing.' };
	if (!Array.isArray(parsed['history'])) return { error: 'activity log is not a list.' };
	return { backup: parsed as unknown as BackupFile };
}

/** Writes the backup through the manager APIs; notes that already exist are kept. */
export async function restoreBackup(m: BackupManagers, b: BackupFile): Promise<void> {
	const dm = m.dataManager;
	await dm.restoreSharedSettings(b.shared);
	for (const t of b.entries.titles) {
		if (!dm.getTitle(t.id)) await dm.addTitleSilent({ ...t });
	}
	for (const mb of b.entries.maybe) {
		if (!dm.getMaybeTitles().some((x) => x.id === mb.id)) await dm.addMaybeTitle({ ...mb });
	}
	dm.notifyChange();
	await m.readingDataManager.restore(b.entries.reading);
	await m.gameDataManager.restore(b.entries.games);
	await m.historyManager.restore(b.history);
}

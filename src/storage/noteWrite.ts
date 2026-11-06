import type { App, TFile } from 'obsidian';
import type { Notify } from './storageTypes';

/** processFrontMatter that reports unreadable YAML as a notice and returns false instead of throwing. */
export async function updateFrontMatter(
	app: App,
	file: TFile,
	notify: Notify,
	fn: (fm: Record<string, unknown>) => void,
): Promise<boolean> {
	try {
		await app.fileManager.processFrontMatter(file, fn);
		return true;
	} catch (e) {
		console.warn(`WatchLog: could not update frontmatter of ${file.path}`, e);
		notify({ code: 'invalidYaml', file: file.basename });
		return false;
	}
}

/** True when `target` is free for a rename; otherwise reports it (the note keeps its old name). */
export function renameTargetFree(app: App, target: string, notify: Notify): boolean {
	if (!app.vault.getAbstractFileByPath(target)) return true;
	notify({ code: 'renameTargetExists', target });
	return false;
}

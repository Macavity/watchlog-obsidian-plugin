import { normalizePath } from 'obsidian';

/** Plugin id of the original WatchLog; its data.json is adopted when this plugin starts empty. */
export const ORIGINAL_PLUGIN_ID = 'watchlog';

export interface LegacyPluginSource {
	configDir: string;
	adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string> };
}

export interface LoadedData {
	raw: unknown;
	/** Folder of the plugin the data was read from; differs from our own only on a takeover. */
	dir?: string;
}

const isEmpty = (raw: unknown): boolean =>
	raw === null || raw === undefined || (typeof raw === 'object' && Object.keys(raw).length === 0);

/**
 * Our own data.json, or, while it is still empty, the one of the original plugin living in the
 * same vault. Lets a switch from the original to this plugin keep entries, settings and API keys.
 */
export async function loadOwnOrOriginal(own: () => Promise<unknown>, src: LegacyPluginSource): Promise<LoadedData> {
	const raw = await own();
	if (!isEmpty(raw)) return { raw };
	const dir = normalizePath(`${src.configDir}/plugins/${ORIGINAL_PLUGIN_ID}`);
	const path = normalizePath(`${dir}/data.json`);
	try {
		if (!(await src.adapter.exists(path))) return { raw };
		const parsed: unknown = JSON.parse(await src.adapter.read(path));
		return isEmpty(parsed) ? { raw } : { raw: parsed, dir };
	} catch (e) {
		console.warn('[WL] could not read the data.json of the original plugin', e);
		return { raw };
	}
}

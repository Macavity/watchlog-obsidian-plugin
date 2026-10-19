// FakeApp holding a schema-1 data.json plus notes as the original plugin wrote them; `run` migrates.
import { parse, stringify } from 'yaml';
import { createFakeApp } from '../fakes/fakeApp';
import { VaultLayout } from '../../src/storage/VaultLayout';
import { LocalStore } from '../../src/storage/LocalStore';
import { SharedConfigStore } from '../../src/storage/SharedConfigStore';
import { HistoryStore } from '../../src/storage/HistoryStore';
import { hasWatchlogKey } from '../../src/storage/baseFile';
import { legacyRoot, migrateV1 } from '../../src/storage/migrateV1';
import type { WatchLogData } from '../../src/types';

const yaml = { parse, stringify };

/** Notes of the fixture entries at their legacy paths (legacy frontmatter, no new keys). */
const LEGACY_NOTES: Record<string, string> = {
	'WatchLog/TV Show/Dark.md': '---\ntitle: "Dark"\ntype: "TV Show"\nstatus: "Watching"\npriority: "High"\nrating: 0\nprogress: 67%\ntotalEpisodes: 18\n---\n\n## Notes\n\nGreat show\n',
	'WatchLog/Reading/Books/Dune.md': '---\ntitle: "Dune"\nauthor: "Frank Herbert"\nstatus: "Reading"\nrating: 0\npagesRead: 120\ntype: book\n---\n\n## Notes\n\n\n## Quotes\n',
	'WatchLog/Reading/Manga/Berserk.md': '---\ntitle: "Berserk"\nauthor: "Kentaro Miura"\nstatus: "On Hold"\ntype: manga\n---\n\n## Notes\n\n\n## Quotes\n',
	'Gaming/Hades.md': '---\ntitle: "Hades"\ndeveloper: "Supergiant"\ntype: game\n---\n\n## Notes\n',
	'Lists/Shopping.md': '# Shopping\n\n## Notes\n\n\n## Data\n```json\n{}\n```\n',
};

export async function setupMigration(legacy: unknown, files: Record<string, string>) {
	const f = createFakeApp({ ...LEGACY_NOTES, ...files });
	f.plugin.data = structuredClone(legacy);

	async function run() {
		const local = new LocalStore(f.plugin);
		const loaded = await local.load();
		if (loaded.schema !== 1) throw new Error('fixture is not schema 1');
		const data: WatchLogData = loaded.legacy;
		const bases = await Promise.all(f.app.vault.getFiles()
			.filter((x) => x.extension === 'base')
			.map(async (x) => ({ path: x.path, hasWatchlogKey: hasWatchlogKey(await f.app.vault.read(x)) })));
		const types = (data.settings.types ?? []).map((t) => t.name);
		const layout = new VaultLayout(VaultLayout.findRoot(bases) ?? legacyRoot(data), () => types);
		const shared = new SharedConfigStore(f.app, () => layout, yaml);
		const history = new HistoryStore(f.app, () => layout);
		return migrateV1({ app: f.app, plugin: f.plugin, local, legacy: data, shared, history, yaml, layout });
	}

	/** Another run against the same vault with the legacy data.json again (a second device). */
	async function rerunFromLegacy() {
		f.plugin.data = structuredClone(legacy);
		return run();
	}

	return { run, rerunFromLegacy, f };
}

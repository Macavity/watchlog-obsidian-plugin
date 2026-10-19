import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { refreshAllCovers, type CoverRefreshDeps } from '../src/coverRefresh';
import { ApiCheckQueue } from '../src/apiCheckQueue';
import { setupGames } from './helpers/setupGameDataManager';
import { setupReadingDataManager } from './helpers/setupReadingDataManager';
import type { DataManager } from '../src/DataManager';
import { setupDataManager } from './helpers/setupDataManager';

const fmOf = (src: string | undefined): Record<string, unknown> =>
	parse(/^---\n([\s\S]*?)\n?---/.exec(src ?? '')?.[1] ?? '') as Record<string, unknown>;

const GAME = (cover: string) => `---\ntitle: Hades\nstatus: Playing\ntype: game\nexternalId: rawg:1\ncoverUrl: ${cover}\n---\n`;
const BOOK = '---\ntitle: Dune\nstatus: Reading\ntype: book\ncoverUrl: https://mine\nexternalId: gbooks:abc\n---\n';
const MANGA = '---\ntitle: Berserk\nstatus: Reading\ntype: manga\ncoverUrl: https://mine\nexternalId: mal:manga:2\n---\n';

type Api = Partial<CoverRefreshDeps['api']>;

async function run(files: Record<string, string>, api: Api, poster?: (dm: DataManager, id: string) => Promise<string | null>) {
	const g = await setupGames(files);
	const r = await setupReadingDataManager(files);
	const d = await setupDataManager(files);
	const deps: CoverRefreshDeps = {
		api: { hasGoogleBooksKey: () => true, ...api } as CoverRefreshDeps['api'],
		gamesApiSource: 'rawg',
		dataManager: d.dm,
		posterService: { enqueue: (t) => poster?.(d.dm, t.id) ?? Promise.resolve(null) },
		readingData: r.rdm,
		gameData: g.gdm,
		queue: new ApiCheckQueue(2, 0),
	};
	const res = await refreshAllCovers(deps);
	return { res, g, r, d };
}

describe('refreshAllCovers', () => {
	it('game: hand-entered cover is replaced by the API cover', async () => {
		const { res, g } = await run({ 'W/Games/Hades.md': GAME('https://mine') }, {
			getRawgGameDetails: async () => ({ coverUrl: 'https://api/x' }),
		} as Api);
		expect(fmOf(g.f.files.get('W/Games/Hades.md')).coverUrl).toBe('https://api/x');
		expect(res.updated).toBe(1);
	});

	it('game: empty or failing API keeps the cover', async () => {
		for (const getRawgGameDetails of [async () => null, async () => { throw new Error('x'); }]) {
			const { res, g } = await run({ 'W/Games/Hades.md': GAME('https://mine') }, { getRawgGameDetails } as Api);
			expect(fmOf(g.f.files.get('W/Games/Hades.md')).coverUrl).toBe('https://mine');
			expect(res.updated).toBe(0);
			expect(res.unchanged).toBe(1);
		}
	});

	it('title: "no poster" never replaces an existing poster; a found one does', async () => {
		const note = '---\ntitle: A\ntype: Movie\nposter: https://mine\n---\n';
		// PosterService on a clean "nothing found" writes 'none' with overwrite
		const { d } = await run({ 'W/Movie/A.md': note }, {}, async (dm, id) => { await dm.updatePosterUrl(id, 'none', true); return null; });
		expect(d.dm.getTitle('Movie/A')?.posterUrl).toBe('https://mine');
		expect(fmOf(d.f.files.get('W/Movie/A.md')).poster).toBe('https://mine');
	});

	it('book and manga: cover is overwritten on success, kept on failure', async () => {
		const files = { 'W/Books/Dune.md': BOOK, 'W/Manga/Berserk.md': MANGA };
		const ok = await run(files, {
			getGoogleBookById: async () => ({ coverUrl: 'https://api/b' }),
			getMangaByMalId: async () => ({ coverUrl: 'https://api/m' }),
		} as Api);
		expect(fmOf(ok.r.f.files.get('W/Books/Dune.md')).coverUrl).toBe('https://api/b');
		expect(fmOf(ok.r.f.files.get('W/Manga/Berserk.md')).coverUrl).toBe('https://api/m');
		expect(ok.res.updated).toBe(2);

		const bad = await run(files, {
			getGoogleBookById: async () => { throw new Error('x'); },
			getMangaByMalId: async () => null,
		} as Api);
		expect(fmOf(bad.r.f.files.get('W/Books/Dune.md')).coverUrl).toBe('https://mine');
		expect(fmOf(bad.r.f.files.get('W/Manga/Berserk.md')).coverUrl).toBe('https://mine');
		expect(bad.res.updated).toBe(0);
	});
});

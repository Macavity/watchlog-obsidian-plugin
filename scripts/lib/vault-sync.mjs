// Mirrors the versioned fixtures of one checkout into the registered test vault, keeping Obsidian's local state.
import { cpSync, existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

/** Paths inside the vault that belong to the running Obsidian, never to the fixtures (mirrors .gitignore). */
function isLocalState(rel) {
	const p = rel.split(sep).join("/");
	const under = (dir) => p === dir || p.startsWith(`${dir}/`);
	return under(".trash") || under(".obsidian/plugins") || under(".obsidian/themes") || under(".obsidian/cache") || /^\.obsidian\/workspace[^/]*\.json$/.test(p);
}

/** Deletes everything at the top level and inside `.obsidian` of `vault` that is not local state. */
function removeStale(vault) {
	for (const rel of ["", ".obsidian"]) {
		const dir = join(vault, rel);
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			const entry = rel ? join(rel, name) : name;
			if (entry === ".obsidian" || isLocalState(entry)) continue;
			rmSync(join(vault, entry), { recursive: true, force: true });
		}
	}
}

/** Makes `vault` contain exactly the files of `fixtures`, except local state. Both must be a `watchlog-test-vault` directory. */
export function syncVault(fixtures, vault) {
	for (const dir of [fixtures, vault]) {
		if (basename(dir) !== "watchlog-test-vault") throw new Error(`refusing to sync ${dir}: not a watchlog-test-vault directory`);
		if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
	}
	// the same directory on both sides would delete the fixtures before copying them
	if (realpathSync(fixtures) === realpathSync(vault)) return;
	removeStale(vault);
	cpSync(fixtures, vault, { recursive: true, filter: (src) => !isLocalState(relative(fixtures, src)) });
}

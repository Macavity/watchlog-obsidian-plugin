// Builds the plugin and copies the output into a vault's .obsidian/plugins/watchlog-sync (copies, not a symlink, so Obsidian Sync picks the files up).
// Usage:
//   node scripts/deploy.mjs [vault-name]   -> a vault registered in Obsidian; without a name, pick from a list
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "watchlog-sync";
const FILES = ["manifest.json", "main.js", "styles.css"];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wanted = process.argv[2];

/** Vaults registered in Obsidian, via its CLI. */
function listVaults() {
	return execFileSync("obsidian", ["vaults", "verbose"], { encoding: "utf8" })
		.split("\n")
		.map((l) => l.split("\t"))
		.filter((c) => c.length >= 2)
		.map(([name, path]) => ({ name, path }));
}

/** Interactive choice from a numbered list; throws when not on a TTY or aborted. */
async function askVault(vaults) {
	if (!process.stdin.isTTY) throw new Error("Pass a vault name: npm run deploy -- <name>");
	console.log("Registered vaults:");
	vaults.forEach((v, i) => console.log(`  ${String(i + 1).padStart(2)}  ${v.name}\t${v.path}`));
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (await rl.question("Deploy plugin into vault # (empty to abort): ")).trim();
		const idx = Number(answer);
		if (!answer || !Number.isInteger(idx) || idx < 1 || idx > vaults.length) throw new Error("aborted");
		return vaults[idx - 1];
	} finally {
		rl.close();
	}
}

async function pickVault() {
	const vaults = listVaults();
	if (vaults.length === 0) throw new Error("No vaults registered in Obsidian.");
	if (wanted) {
		const hits = vaults.filter((v) => v.name === wanted);
		if (hits.length > 1) throw new Error(`Several vaults are named "${wanted}":\n` + hits.map((v) => `  ${v.path}`).join("\n"));
		if (hits[0]) return hits[0];
		console.error(`No registered vault named "${wanted}".`);
	}
	return askVault(vaults);
}

try {
	const v = await pickVault();
	execFileSync("npm", ["run", "build"], { cwd: REPO, stdio: "inherit" });
	const target = join(v.path, ".obsidian", "plugins", PLUGIN_ID);
	mkdirSync(target, { recursive: true });
	for (const f of FILES) copyFileSync(join(REPO, f), join(target, f));
	console.log(`copied ${FILES.join(", ")} to ${target}`);
	console.log(`Reload "WatchLog" in "${v.name}" (or: obsidian vault="${v.name}" plugin:reload id=${PLUGIN_ID}).`);
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
}

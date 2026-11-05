// Obsidian CLI wrapper. Every call targets vault="watchlog-test-vault"; nothing else is allowed.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT = "watchlog-test-vault";
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** This checkout's versioned fixtures. */
export const FIXTURES = join(REPO, "watchlog-test-vault");
/** The vault registered in Obsidian: watchlog-test-vault next to the main checkout, outside git (every checkout mirrors its
 * fixtures into it, so it survives worktrees and never blocks a pull), or $WATCHLOG_TEST_VAULT. */
export const VAULT_PATH = process.env.WATCHLOG_TEST_VAULT ? resolve(process.env.WATCHLOG_TEST_VAULT) : join(dirname(mainCheckout()), "watchlog-test-vault");

function mainCheckout() {
	try {
		const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: REPO, encoding: "utf8" }).trim();
		return dirname(common);
	} catch {
		return REPO;
	}
}

const CLI_TIMEOUT_MS = 30000;

function run(args) {
	try {
		return execFileSync("obsidian", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: CLI_TIMEOUT_MS, killSignal: "SIGKILL" });
	} catch (e) {
		if (e?.code === "ETIMEDOUT" || e?.killed) return afterTimeout(args, e);
		throw e;
	}
}

/** The CLI occasionally prints its result and then never exits; that answer is still good. Otherwise Obsidian is stuck. */
function afterTimeout(args, e) {
	const out = String(e.stdout ?? "");
	if (out.trim() !== "" && !out.trimStart().startsWith("Error:")) return out;
	throw new Error(
		`obsidian ${args.slice(1, 2).join(" ")} timed out after ${CLI_TIMEOUT_MS / 1000}s. ` +
			"Obsidian is probably hung or its window is hidden: run `obsidian vault=\"watchlog-test-vault\" reload`, then `pnpm vault:reset`.",
	);
}

/** Runs `obsidian vault="watchlog-test-vault" <cmd> key=value ...`. Throws if the output starts with "Error:". */
export function obs(cmd, args = {}) {
	const argv = [`vault=${VAULT}`, cmd];
	for (const [k, v] of Object.entries(args)) argv.push(v === true ? k : `${k}=${v}`);
	const out = run(argv);
	if (out.trimStart().startsWith("Error:")) throw new Error(`obsidian ${cmd}: ${out.trim()}`);
	return out;
}

export function evalJs(code) {
	return obs("eval", { code }).trim().replace(/^=> ?/, ""); // eval prints "=> <result>"
}

/** Brings the Obsidian window to the front, since `dev:screenshot` hangs on a hidden window. Needs macOS and automation
 * permission; without them the screenshot is tried anyway. */
function focusObsidian() {
	try {
		execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']);
	} catch {
		// not macOS or no permission; screenshots may still work
	}
}

/** Saves a screenshot of the Obsidian window to `path`: focuses the window first and retries once. */
export function screenshot(path) {
	for (let attempt = 0; ; attempt++) {
		focusObsidian();
		try {
			return obs("dev:screenshot", { path });
		} catch (e) {
			if (attempt >= 1) throw e;
			console.warn(`screenshot ${path} failed once, retrying: ${e.message}`);
		}
	}
}

export function assert(cond, msg) {
	if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export async function waitFor(fn, timeoutMs = 10000, intervalMs = 250) {
	const end = Date.now() + timeoutMs;
	let last;
	while (Date.now() < end) {
		try {
			last = await fn();
			if (last) return last;
		} catch (e) {
			last = e;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms (last: ${last instanceof Error ? last.message : last})`);
}

/** Registered vaults as [{ name, path }], via `obsidian vaults verbose`. */
export function listVaults() {
	return run(["vaults", "verbose"])
		.split("\n")
		.map((l) => l.split("\t"))
		.filter((c) => c.length >= 2)
		.map(([name, path]) => ({ name, path }));
}

/** Aborts unless exactly one registered vault is named "watchlog-test-vault" and it points to VAULT_PATH. */
export function ensureVault() {
	const rows = listVaults().map(({ name, path }) => [name, path]);
	const hits = rows.filter(([name]) => name === VAULT);
	const hint = `Run \`pnpm vault:open\`, open ${VAULT_PATH} via "Open folder as vault" in Obsidian, then \`pnpm run deploy watchlog-test-vault\`.`;
	if (hits.length === 0) throw new Error(`Vault "${VAULT}" is not registered. ${hint}`);
	if (hits.length > 1) throw new Error(`Several vaults are named "${VAULT}"; refusing to run.`);
	const real = (p) => {
		try {
			return realpathSync(p);
		} catch {
			return resolve(p);
		}
	};
	if (real(hits[0][1]) !== real(VAULT_PATH)) {
		throw new Error(`Vault "${VAULT}" points to ${hits[0][1]}, expected ${VAULT_PATH}. Refusing to run.`);
	}
}

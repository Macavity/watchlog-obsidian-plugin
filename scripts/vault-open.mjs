// Mirrors this checkout's fixtures into the test vault (next to the main checkout, outside git) and opens it in Obsidian.
// First time: Obsidian does not know the folder yet; open it once via "Open folder as vault".
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { FIXTURES, VAULT_PATH } from "./lib/cli.mjs";
import { syncVault } from "./lib/vault-sync.mjs";

mkdirSync(VAULT_PATH, { recursive: true });
syncVault(FIXTURES, VAULT_PATH);
const url = `obsidian://open?path=${encodeURIComponent(VAULT_PATH)}`;
const [cmd, args] =
	process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
execFileSync(cmd, args, { stdio: "inherit" });
console.log(`opened ${url}`);
console.log(`Not registered yet? In Obsidian: "Open folder as vault" -> ${VAULT_PATH}`);

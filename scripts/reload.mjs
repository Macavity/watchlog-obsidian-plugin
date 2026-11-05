import { obs, ensureVault } from "./lib/cli.mjs";

ensureVault();
console.log(obs("plugin:reload", { id: "watchlog-sync" }).trim());

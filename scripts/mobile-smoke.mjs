// Mobile smoke for the add title modal: switches the running Obsidian to tablet emulation (`dev:mobile on`, which reloads
// the app), stubs the anime search with 9 fixed results, opens "Add title" and searches. Then narrows the viewport to a
// phone (Obsidian: below 600px) and checks the results panel keeps its height instead of being squashed by the capped modal
// column. Saves screenshots and switches emulation off again. Obsidian must be running with the test vault open and the
// current build deployed (`pnpm vault:open`, `pnpm run deploy watchlog-test-vault`, `pnpm reload`).
// Output dir: $MOBILE_SMOKE_OUT or <tmp>/watchlog-mobile.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, ensureVault, evalJs, obs, screenshot, waitFor } from "./lib/cli.mjs";

const OUT = process.env.MOBILE_SMOKE_OUT ?? join(tmpdir(), "watchlog-mobile");
const PHONE_WIDTH = 360; // a small Android phone; iPhones start at 375
const RESULTS = 9; // one page
const MIN_PANEL_HEIGHT = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (code) => JSON.parse(evalJs(`JSON.stringify(${code})`));
const cdp = (method, params) => obs("dev:cdp", { method, params: JSON.stringify(params) });

ensureVault();
mkdirSync(OUT, { recursive: true });

/** `dev:mobile` reloads the app; until it is back, every CLI command answers "Command … not found". */
function untilReady() {
	return waitFor(() => {
		try {
			return evalJs("app.plugins.plugins['watchlog-sync'] ? 'ok' : 'no'") === "ok";
		} catch {
			return false;
		}
	}, 30000, 500);
}

/** Replaces the anime APIs with fixed results in the AnimeSearchResult shape; the next app reload restores them. */
const STUB = `(() => {
	const api = app.plugins.plugins['watchlog-sync'].apiService;
	const results = Array.from({ length: ${RESULTS} }, (_, i) => ({
		malId: 900000 + i, title: 'Smoke result ' + (i + 1), episodes: 12, duration: 24, releaseDate: '2024-01-01',
		url: '', seasons: [], posterUrl: '',
	}));
	api.searchAnime = api.searchAniList = async () => results;
	return 'ok';
})()`;
/** Forces the type select to Anime (the stubbed API group) and starts a search through the UI. */
const SEARCH = `(() => {
	const modal = document.querySelector('.wl-add-modal');
	const type = modal.querySelector('select');
	if (type && type.value !== 'Anime') { type.value = 'Anime'; type.dispatchEvent(new Event('change')); }
	const query = modal.querySelector('.wl-search-query');
	query.value = 'smoke';
	query.dispatchEvent(new Event('input'));
	modal.querySelector('.wl-search-fields .wl-btn').click();
	return 'ok';
})()`;
const CARDS = `String(document.querySelectorAll('.wl-add-modal > .wl-modal-results .wl-result-card').length)`;
const IS_PHONE = `String(document.body.classList.contains('is-phone'))`;
const PANEL = `(() => {
	const panel = document.querySelector('.wl-add-modal > .wl-modal-results');
	const card = panel?.querySelector('.wl-result-card');
	if (!panel || !card) return null;
	const p = panel.getBoundingClientRect(), c = card.getBoundingClientRect();
	return { height: p.height, cardVisible: c.top >= p.top && c.top + 40 <= p.bottom, cards: panel.querySelectorAll('.wl-result-card').length };
})()`;

const failures = [];

/** Records a failure for each way the phone results panel can fall short. */
function checkPanel(m) {
	if (!m) return failures.push("phone: results panel or card not found");
	if (m.cards !== RESULTS) failures.push(`phone: ${m.cards} result cards, expected ${RESULTS}`);
	if (m.height < MIN_PANEL_HEIGHT) failures.push(`phone: results panel ${Math.round(m.height)}px tall, expected >= ${MIN_PANEL_HEIGHT}`);
	if (!m.cardVisible) failures.push("phone: first result card not visible inside the panel");
}

try {
	console.log(obs("dev:mobile", { on: true }).trim());
	await sleep(1500);
	await untilReady();
	assert(evalJs(STUB) === "ok", "search stub not installed");
	evalJs("app.commands.executeCommandById('watchlog-sync:add-title')");
	await waitFor(() => evalJs("document.querySelector('.wl-add-modal .wl-search-query') ? 'yes' : 'no'") === "yes", 10000);
	evalJs(SEARCH);
	await waitFor(() => evalJs(CARDS) === String(RESULTS), 10000);
	await sleep(300);
	screenshot(join(OUT, "tablet-add-title.png"));

	// Phone: the viewport override survives reloads, so the finally block clears it.
	cdp("Emulation.setDeviceMetricsOverride", { width: PHONE_WIDTH, height: 800, deviceScaleFactor: 2, mobile: true });
	await waitFor(() => evalJs(IS_PHONE) === "true", 5000);
	await sleep(500);
	checkPanel(json(PANEL));
	screenshot(join(OUT, "phone-add-title.png"));
} catch (e) {
	failures.push(`smoke aborted: ${e.message}`);
} finally {
	// Leave Obsidian as found even after a failure: modal closed, desktop mode. Problems here join `failures` instead of
	// throwing, so they never replace the failure that got us here.
	try {
		evalJs("document.querySelector('.wl-add-modal')?.closest('.modal')?.querySelector('.modal-close-button')?.click()");
	} catch {
		// the app may still be reloading; the reload closes the modal anyway
	}
	try {
		cdp("Emulation.clearDeviceMetricsOverride", {});
	} catch (e) {
		failures.push(`clearing the phone viewport failed: ${e.message}`);
	}
	try {
		console.log(obs("dev:mobile", { off: true }).trim());
	} catch (e) {
		failures.push(`dev:mobile off failed: ${e.message}`);
	}
	await sleep(1500);
	try {
		await untilReady();
		if (evalJs("String(app.isMobile)") !== "false") failures.push("Obsidian is still in mobile emulation");
	} catch (e) {
		failures.push(`Obsidian did not answer after dev:mobile off: ${e.message}`);
	}
}
console.log(`screenshots in ${OUT}`);
if (failures.length) {
	console.error(failures.join("\n"));
	process.exit(1);
}
console.log("mobile ok");

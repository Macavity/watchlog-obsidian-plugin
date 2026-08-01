# Changelog

All notable changes to WatchLog are documented here.

## [3.0.0] - 2026-08-01

##### Added

**Games tab (new library)**
- **Games** — a new top-level tab with its own library, stored alongside with other data, come with every feature that Watchlist and Reading has
- **Game APIs** — search and auto-fill from **RAWG** (default) or **IGDB**, selectable in Settings → API → Games. Everything also works fully manually with no API key.
- **Steam sync** — connect with Steam ID + API key and sync your library: matched games take **playtime, last played and achievements** straight from Steam, while status, rating, priority, favorite, wishlist and notes are never touched. Games you own but haven't added yet are shown as a checklist for one-click import. Runs with progress and a working Cancel.
- **Game modes pill** — Solo / Co-op / Multi toggles on each game, any combination.
- **Wishlist flag** — a game can be flagged as wishlist (gift icon in the modal, amber badge on the card, also in the filter row).
- **Games note files** — one Markdown note per game at `WatchLog/Games/<Title>.md`, body-preserving and rename-aware.
- **Games everywhere** — Games now appear in Drafts (add-to-Games choice + "In Games" duplicate detection), Custom Lists autocomplete, the Dashboard statistics, the Log timeline and backup/restore.
- **Games in Upcoming** — games with a release date get a schedule entry (single release date; no recurrence, since a game releases once).

**Cards & layout**
- **Rows / shelves layout in Watchlist and Reading** — the old flat Cards grid is now a customizable shelf layout: Favorites, Recommended, Recently Added, Recently Watched / Recently Read, Groups, Recently Released, plus grouped grids **By type** or **By status** (mutually exclusive). Turning everything off gives you exactly the old Cards view back.
- **Card size slider** — seven sizes (100 → 250 px), separate desktop and mobile sliders, in Settings → Customize → **Cards**. Default is 160 px; the old default (140 px) is one step down.
- **Per-tab card text placement** — choose **Under** (name/type/progress in a block below the poster) or **Inside** (classic overlay) independently for Watchlist, Games, Reading and Upcoming, with illustrated preview tiles and an apply-to-all shortcut.
- **Uniform card sizes** — shelf cards now mirror the grid's computed card width, so every tab's cards are the same size at a given pane width.
- **Upcoming Cards view** — the Upcoming tracker gained a List/Cards toggle; Cards is a month-grouped poster grid with a big countdown badge, tick button and ⋮ menu per card.

**Ratings & credits**
- **Half-star ratings** — optional half-star precision (0.5 steps) on every rating input - toggle in Plugin Settings
- **Rating system** — five editable tiers with their own label and colour ("Poor" … "Masterpiece"); filled stars take the current tier's colour and the label shows next to them. Applies across Watchlist, Reading and Games.
- **Manual director & cast** — you can now add your own director/cast entries on top of the fetched ones (fetched list capped at 10, 4 shown inline before expanding).
- **Top Actors / Top Directors** on the Dashboard, with a configurable "how many to show" setting.
- **Favorites** — a favorite flag on Watchlist titles and Reading items (heart toggle), driving the Favorites shelf on every tab.

**Collections & studios**
- **Collections** — movies that belong to a film series (Harry Potter, John Wick, Alien…) get a **Collection** button in the detail modal.TMDB only feature, OMDb doesn't have it. Movies only, TMDB has no equivalent for TV.
- **Studio / network** — a third credits field next to Director and Cast. Movies and TV get their production companies (networks first for TV) from TMDB, anime gets its studio from Jikan or AniList.
- **"Fetch studios for all titles"** (Settings → General) — fills the field for an existing library in bulk, chunked and cancelable. New titles get it at add time, and older ones fill in on their own the first time you open them.

**Adding things**
- **Already-in-library markers** — search results in the Add title / Add game / Add book & manga modals now flag what you already own with a green **✓ Watchlist / Books / Manga / Games** badge.
- **Add to library from Custom Lists** — every named row gets a **+** in its action icons, opening the same Watchlist / Book / Manga / Game chooser the Drafts cards use, with the row name prefilled.

**Reading**
- **Pages or words for books** — each book can track progress in **pages** or **words**, switched with a Pages/Words pill in the detail modal. 
- **Editable Reading status colours** — Settings → Customize → Reading → Status.
- **Reading CSV** gained `progressUnit` / `wordsRead` / `totalWords` columns.

**Dashboard**
- **More Statistics now covers all four libraries** — Watchlist, Reading and Games feed Added Over Time / By Status / By Type / By Year, with a centred **source filter** (All / Watchlist / Reading / Games) to narrow it down. "Titles in library" and "Completed" count all four. Cards with no data are hidden entirely.

**Dates**
- **Date format setting** (Settings → General): `European (09/03/2026)`, `American (03/09/2026)` or `ISO (2026-03-09)`, with live previews. Purely presentational — stored data is untouched, so switching is safe at any time.
- **New shared date picker** — every date field in the plugin now uses one component with a proper calendar popup (month nav, today/selected highlighting, Today / Clear footer, week start follows the format). Replaces both the old text-only fields and the native pickers that ignored your format setting.

**Other**
- **Mark as Watched button** — Movies (and any single-episode title) get a single "Mark as Watched" button instead of a lone episode box; pressing it ticks the episode, sets Completed and stamps today's date, and pressing it again reverts all three.
- **Buy me a coffee button** in Settings → General, if you want to support the plugin.

##### Improved
- **Search rebuilt** — Watchlist, Reading and Games used to have three unrelated search implementations; All three now share one engine and one syntax:
  - `dune` — fuzzy, several words must all match (across fields, so `scarlett johansson marvel` works)
  - `"no time to die"` — quoted means exact, never fuzzy
  - `studio:pierrot`, `dev:rockstar`, `author:herbert` — scoped to one field
  - `year:>2010`, `rating:>=4`, `pages:<300`, `hours:>20` — numeric comparisons
  - `marvel | dc` — either one; `-anime` — exclude
- **Detail modals on mobile** — Watchlist, Reading and Games detail modals were rebuilt for phone width.
- **Sticky modal footer** — the action bar in the Watchlist, Reading, Games and Collection modals stays pinned to the bottom, so it is still reachable in a long modal.
- **Settings rebuilt as accent-coloured group cards** — API, General, Watchlist, Customize, Drafts, Custom Lists and Reading pages all now use the same card shell: coloured header with icon, sub-line and a live status chip, over a plain body. Every setting, default and handler is unchanged; only the layout moved.
- **API page as provider cards** — four groups (Movies & TV, Anime, Books & manga, Games), each provider on its own card with a password reveal toggle, a live status chip that updates as you type, a "Get a key ↗" link, a foldable `(?)` help text and a Test button. The Active-API dropdown became a segmented pill, and inactive providers dim.
- **Customize page** — five groups (Theme, Watchlist, Reading, Games, Shared) with live counts in the header chip ("5 types · 6 statuses"), and every colour list now sits in a card with foldable help text.
- **Games in Settings → Customize** — Genre and Platform lists are fully editable (recolour, rename, add, remove) with renames cascading into your games and filters; Status is colour-only since the names carry behaviour.
- **Coloured platform chips** — platform chips now use their configured colour instead of a hardcoded purple.
- **Upcoming Schedule** — was revamped to a better view and for a better undrestanding
- **Minor UI changes** - some minor UI changes here and there and some visual bugs fixed, especially on Mobile view
- **Drafts** - duplicate detection covers the whole library, and the badge names where it found the title: In Watchlist / In Books / In Manga / In Games.


## [2.2.0] - 2026-07-05

##### Added
- **Per-list tab color** - each custom list tab can now be assigned a color, applied to its tab name. Set it via a color picker in Table settings (renamed from "Edit columns").
- **Per-option colors for select columns** - each option of a select-type column can be given its own color, defined per table; the colored badge reflects the option's color in both the cell and the selection dropdown.
- **Custom colors everywhere** - the color picker now offers the 8 presets plus a full-spectrum custom color, with a built-in reset-to-default. Available for Custom Lists tab/option colors and Reading field colors alike.
- **Column resizing** - Columns now can be resized
- **TSV export** - Export now offers a format chooser: copy as TSV (pastes cleanly into Google Sheets / Excel as columns) or as Markdown (for pasting into notes).
- **Import rows** - a new Import button lets you paste tab-separated data copied from a spreadsheet to append rows to the current list
- **Select-all tick** - a tick in the table header checks or unchecks all visible rows at once.
- Now you can select default content type for adding titles - pick a fixed type or `* Last type used` (remembers your last choice) in Settings → Watchlist.
- Richer note frontmatter — Watchlist notes now carry review, dates, episode duration, IDs, community rating, a single resolved poster, and more; Reading notes add cover, external link, and modified date. Makes notes portable and `.base`-friendly.
- "Rewrite frontmatter on all notes" button (Settings → General) to apply the enriched frontmatter to existing notes - chunked, cancelable, preserves note bodies.
- Cover thumbnails in search results when adding titles, books, and manga, so you can tell same-named entries apart.
- **Director & cast fields** on Watchlist titles (`director`, `cast` — both `string[]`). Cast is hardcoded-capped at 4 across every source, so a title looks identical regardless of which API supplied it.
- **Lazy backfill on modal open**: opening `TitleDetailModal` for an older title missing the fields triggers a one-time fetch keyed off the IMDb id in its external link (prefers active API, falls back to the other keyed one). Persists through a new `DataManager.updateCredits()` that writes both `data.json` and the note frontmatter in one operation — not the silent poster path.
- **UI**: shared `renderCreditsRows` renders Director/Cast in the modal (below the stats box) and in the List view expanded row (under the "Not started" line). Names render as clickable chips (theme-variable CSS).
- **Click-to-filter**: clicking a name routes it into the existing search bar — visible, clearable, and matching typed-search behaviour.
- **YouTube trailers** — auto-fetched at add-time (TMDB, Jikan, AniList; OMDb has none), stored per title, shown as a red YouTube icon on the detail row and saved to note frontmatter. Manual override field in Edit. Existing titles get a refresh button to fetch on demand.
- Added the cover image to the left of the title detail modal (Movie/Series), with the full header block (title + badges + stats) moved to its right, mirroring the Reading modal layout. Letter-placeholder fallback when no poster exists.

##### Improved
- Add-title form compacted (Episodes/Duration and Status/Priority paired onto single rows), giving the search results more room.
- Dashboard grid now adapts to panel width on mobile (3→2→1 columns); desktop unchanged.
- Mobile tab bar switched to icons so all tabs fit on one row without scrolling.
##### Changed
- Switching a column to **select** now populates its options from the distinct values already present in that column's cells (in order of first appearance), preserving existing cell values instead of resurrecting stale options.
- **Dashboard** — default card style is now rectangles for new installs.
- **Edit modal** — Status/Priority, Total episodes/Ep. duration, and Date started/Date finished now share rows; added the "Add to group / create new group" section.

##### Fixed
- **Cover art accuracy** - posters are now matched by media type (Movie vs TV Show), preferring the correct release year, and resolved directly via IMDb id when available, instead of blindly taking the first multi-search result. Fixes cases where the wrong image was pulled (e.g. a film getting its TV series' poster). Applies to both TMDB and OMDb.
- Watchlist notes no longer overwrite content you wrote by hand directly in the `.md` file.
- Title frontmatter now escapes special characters - titles or links containing `:` no longer break the YAML.
- Dashboard no longer overflows off-screen on mobile.
- Fixed the whole view dragging sideways like a loose sheet on mobile.
- **Cards view** — selection now works (click a card to select, 3px purple border on selected); fixed the flicker when entering/exiting selection mode (no more full tab rebuild).
- Fixed the progressively-climbing CLS on scroll in Cards View.


## [2.1.0] - 2026-06-17

### Added
- **Open note button** — a new file-text icon in the title detail modal opens the title's `.md` note directly in Obsidian. Available in both the Watchlist and Reading (Books + Manga) modals.
- **Mobile toolbar toggle** — on mobile, a chevron button collapses the action buttons behind a toggle so the search bar stays usable by default. Search ↔ actions swap with a crossfade. Added to both the Watchlist and Reading tabs.
- **"Season watched" log event** — ticking an entire season now records a single summary "Season X watched" entry in the Log, but only when that action completes the season.
- **Add chooser modal** — the "+ add" button now opens a small chooser offering "Add from URL" and "Add manually / via API", consolidating the two add paths into one entry point (desktop and mobile).

### Fixed
- Reading titles not appearing on mobile.

## [2.0.0] - 2026-06-07

##### Added
- Added **Cards sub-tab** in Watchlist with a responsive poster card grid
	- Poster images auto-fetched from Jikan, TMDB, Google Books or OMDb and cached locally
- Added: **AniList API** as alternative anime source; toggle between Jikan and AniList in Settings
- Added: **Community Ratings**; IMDb, MAL, AniList, or TMDB scores displayed alongside personal star rating with manual refresh and 30-day auto-refresh
- Added: **API routing by type**; configurable API mapping per custom type in Settings; locked defaults for Anime, Movie, TV Show
- Added: manual **Poster URL** override field in Edit modal
- Added: **"Groups only"** filter in Watchlist; show only group headers, hide standalone titles
- Added: **"All" toggle** per filter section; quick select/deselect all within Type, Status, Rating, Priority, Group
- Added: status dropdown directly on expanded title row (no need to open Edit modal)
- Added: "Today" button on Date Watched field (auto-fills only when empty)
- Added: **Skip Episodes**; mark episodes as skippable (filler, recaps, etc.) per season
    - Define skip episodes in season syntax: `"Season 1: 48 (33-37,42)"`
    - Skipped episodes shown with purple border (`#6b2972`) and dash (—) marker
    - 3-state click cycle for skip-defined episodes: skipped → watched → empty
    - Skip stats displayed in Edit modal: "X to skip · Y to watch" next to Total Episodes and below Seasons
    - Season headers show skip count (e.g. "East Blue Saga 48 eps (5 to skip)")
    - Progress calculations exclude skipped episodes from totals
- Added: status badge moved to the top of the Watchlist detail modal, inline next to the title type, with a colored click-to-change dropdown (matching Reading)
- Added: Upcoming due count in the status bar; shows "N due" with the plugin icon, hidden when zero, click opens the Upcoming tab
- Added: Settings toggle "Show Upcoming count in status bar" (General, on by default)
- Added: Reading section in Quick Info with help entries; updated API & Search entry to reflect current APIs (AniList, Google Books)
- Added new **"Watchlist" settings tab** (renamed from Folders)
- Added **Reading integration into Dashboard**; new Books and Manga cards at the end of the grid
  • "left" counts Reading + Plan to read; To be released excluded from the calculation
  • Progress bar shows pages/chapters read of total, with an inline pages / chapters · vol line below
  • Reflected in both Rectangles and Circles dashboard styles
- Added **unified Total/Time card**; Total, Time watched, and Time remaining merged into one card with three equal segments
- Added **Reading in Upcoming**; titles already in Reading can be added via the "+ add" finder (now searches Reading), shown with Book/Manga badges
- Added **Reading schedule modal**; derived from the Anime scheduler; no Time field, Current/Total chapters + volumes, recurrence and auto-increment, 0/1 total treated as a single release date
- Added **Reading in Custom Lists**; name-cell autocomplete now searches Reading alongside Watchlist
- Added **Drafts add gate**; the Add button opens a choice modal (Add in Watchlist / Add book / Add manga), each opening the correct modal with the draft text prefilled
- Added **Release date field** to the Reading modal, inline next to Added; manually editable with optional API import (Google Books / Jikan)
- Added **Reading colors** section in Settings → Customize (below Season colors); color pickers for Manga and Book
- Added: **Show hint banners** toggle in Settings > General; hide/show informational banners in Upcoming, Custom Lists, and Drafts
- Added: **Auto-populate Time column** in Custom Lists; number columns can pull remaining watch time (in minutes) from Watchlist titles with exact name match
  - Enable via ⏱ toggle in Edit Columns for any number-type column
  - Values are persisted and only re-fetched on demand via ↻ refresh icon in column header
  - Titles not found in Watchlist show "Not found"

- Added **Log** as standalone top-level tab (extracted from Watchlist); unified timeline for both Watchlist and Reading events
  • Vertical timeline with colored dots and connector lines
  • Day-grouped entries with date headers
  • Action color coding: green (Completed/Watched), blue (Added), red (Deleted), amber (Status/Rating changed)
  • Source filter toolbar: All / Watchlist / Reading

- Added **Reading tab** with two sub-tabs: Books and Manga; fully independent from the existing Watchlist
- Added separate `reading.json` storage with dedicated `ReadingDataManager` for CRUD operations, change listeners, and schema migrations
- Added **Book tracking** with fields: title, author, status, rating, pages read/total, chapters read/total, cover URL, Open Library ID, vault page link, dates, custom fields
- Added **Manga tracking** with fields: title, author, status, rating, chapters read/total, volumes read/total, cover URL, MAL ID, vault page link, dates, custom fields
- Added **Card grid view** for both Books and Manga with responsive layout, cover images, status dots, progress bars, and author display
- Added **Detail modal** with cover, title, author, status badge, rating, Open note button, vault page controls (Change/Open with filename display and full path tooltip)
- Added **Custom fields system** per sub-tab: user-defined columns (text / number / select) with per-column color picker (8 preset colors)
    - Two display styles with toggle: **Fill** (key cell background) and **Border** (key cell border with rounded corners)
    - Inline editing in Detail modal (text input, number input, or select dropdown)
- Added **Manage Columns modal** with horizontal row layout: drag handle, name input, type dropdown, color dot picker, options input (for select type), delete button — all aligned inline
- Added **Favorite Quotes** section in Detail modal: parsed from `## Quotes` in the auto-generated `.md` file, displayed as styled callout blocks with page/chapter reference; Add quote inline form
- Added **Auto-generated `.md` files** per title at `WatchLog/Reading/Books/<Title>.md` or `WatchLog/Reading/Manga/<Title>.md` with YAML frontmatter, `## Notes`, and `## Quotes` sections; frontmatter syncs on edit
- Added **Jikan manga lookup** in Add Manga modal: search by title or MAL ID, auto-fill title/author/chapters/volumes/cover/MAL ID
- Added default reading folder path setting (default `WatchLog/Reading`)


##### Improved
- Improved: Custom Lists; Edit Columns modal redesigned as horizontal cards
- Improved: # and Name columns shown as grayed-out/non-editable in Edit Columns modal
- Improved: Edit Columns modal wider to fit card layout
- Improved: Cards sub-tab is now the default Watchlist view
- Improved: "History" sub-tabs renamed to "Log" in Watchlist and Upcoming
- Improved: **API settings tab** restructured into three faded callout sections — Movies & TV Shows, Anime, Books — with consistent key/test/status layout
- Improved: **shared danger/success button colors** consolidated into reusable utility classes (red borders for delete/remove, green for add), with softened resting borders
- Improved: Backup/Restore now covers all three data files (watch, reading, history) via a versioned format, with legacy backups still restorable
- Improved: removed the Custom Lists mobile input modal; tapping a cell now uses inline editing directly on both mobile and desktop (the modal was a workaround for the now-fixed keyboard bug)
- 

##### Fixed
- Fixed: titles inside groups now appear correctly when filtering by status
- Fixed: priority is automatically cleared when a title is marked as Completed
- Fixed: mobile keyboard layout bug; when the keyboard opened on iOS and Android, the scrollable content area collapsed and a blank/dark region covered most of the view above the keyboard. Content was present but hidden behind it.
- Fixed: Custom Lists — adding a new column no longer resets row checkboxes
- Fixed: custom field fill mode text color now black for readability

##### Performance
- Performance: optimized episode click handling; direct DOM updates with debounced save, eliminated redundant re-renders
- Performance: centralized save pipeline, batch CSV imports, debounced inputs, Map-based lookups, dead code removal, listener leak fixes
- Performance: the keyboard layout fix is debounced via requestAnimationFrame (one write per frame), with redundant-write skipping, no duplicate observers, and full teardown on view close


##### Removed
- Removed the **"Default view"** setting; the panel now always opens on Dashboard
- Removed the standalone **"Folders"** settings tab (its contents moved into the new "Watchlist" tab)


## [1.1.0] - 2026-05-12

### Changed
- Minimum Obsidian version bumped to 1.7.2

### Fixed
- Performance improvements for the Drafts tab; smoother rendering and reduced UI lag during list operations.
- Simplified `CsvModal.ts` CSV export to use `document.createElement` directly
- File names with forbidden characters are now sanitized in the title property, fixing broken notes for titles containing characters such as `:` 


## [1.0.9] - 2026-04-26
### Initial public release
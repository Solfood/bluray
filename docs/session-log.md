# Session Log

Append-only continuity log.

---

### 2026-07-10 - Session 7

- Markers: `BLU-ARCH-0002`
- Objective: Finish the full-app plan — Tasks 10–12 (backup service, Docker packaging, migration prep).
- Work completed:
  - Task 10: `server/services/backup.ts` — `runBackup()` writes `$DATA_DIR/exports/movies.json` always, pushes to GitHub contents API (`[skip ci]`, sha-aware, non-force) when `GITHUB_TOKEN`+`GITHUB_REPO` set; records `last_backup_at`/`last_backup_ok` meta. `server/scheduler.ts` replaced placeholder: 30s-after-boot then hourly tick, backs up when last is missing/>24h. 3 new tests incl. token-never-leaks-in-errors.
  - Task 11: `Dockerfile` (multi-stage, node:22-alpine, non-root, better-sqlite3 compiled in build stage), `compose.yaml` (`./data:/data`, LAN-only notes per TM-0001), `.env.example`, root `README.md` with host-side import path. Verified: image builds; `docker compose up` serves HTML ("Collection") on :3000.
  - Task 12 (local steps): imported real `movies.json` (41 movies → 41 SQLite rows); full suite 66/66 pass — evidence at `docs/evidence/BLU-ARCH-0002-test-run-2026-07-10.txt`. Filed BLU-ARCH-0003 (legacy retirement) as PLANNED.
- Deviations from plan: added `.env` to the existing `.dockerignore` — plan's `COPY . .` would otherwise bake secrets into the image (TM-0001).
- Open issues/blockers: Remaining Task 12 steps are operational on `bluray.local`: deploy parallel to static site, run parallel-run checklist (plan §Task 12 Step 3), cutover reverse proxy to :3000, verify first automated backup push. BLU-ARCH-0002 stays IN_PROGRESS until then; BLU-ARCH-0003 stays PLANNED until the backup-push gate passes.
- Next actions: On the home server: `cp .env.example .env` (fill keys), host-side import, `docker compose up -d --build`, work the parallel-run checklist, then cutover + `/handoff` to mark DONE.
- References: BLU-ARCH-0002, BLU-ARCH-0003, DEC-0002, TM-0001

---

### 2026-07-06/07 - Session 6 (retroactive entry)

- Markers: `BLU-ARCH-0002`
- Objective: DEC-0002 decided (RRv7 full-stack rewrite); Tasks 1–9 of the plan executed across the sessions of 2026-07-06/07.
- Work completed: RRv7 scaffold at repo root; SQLite layer (schema, FTS5, CRUD); import/export with lossless round-trip; shared matching utils; server TMDB+lookup services; movies CRUD API; enrichment service (details_scraper.py port) + retry endpoint; cover-ID endpoint with hard monthly cap (TOCTOU reservation, NaN cap fixes); UI port (home route, server-lookup hook, personal tracking controls). 15 commits on `blu-arch-0002-full-app`.
- Note: this entry backfills sessions that were not logged at the time; see git log 2026-07-07 for the full sequence.
- References: BLU-ARCH-0002, DEC-0002, TM-0001, docs/superpowers/plans/2026-07-06-full-app-refactor.md

---

### 2026-04-24 - Session 5

- Markers: `BLU-UX-0001`, `BLU-UX-0002`
- Objective: Surface enrichment data in the UI — genres filter + MovieDetail tech specs.
- Work completed:
  - MovieDetail.jsx: added tagline (italic, conditionally shown), runtime ("1h 43m" format) in meta row, genre chips (purple), audio tracks and production countries in tech specs grid. All fields handled defensively for older records that lack them.
  - App.jsx: genre filter chips above MovieGrid — derives available genres from movies array, "All" resets filter, clicking active genre deselects. Filter composes with existing text search.
- Decisions made: No DEC file needed — additive UI change, no new data or auth surface.
- Open issues/blockers: Genres and taglines only appear on movies enriched after this session's details_scraper.py update; older records will gain them on next enrichment run.
- Next actions: None outstanding. Consider BLU-UX-0003 (genre chip on MovieCard overlay) if grid density warrants it.
- References: BLU-DATA-0001, BLU-UX-0001, BLU-UX-0002

---

### 2026-04-24 - Session 4

- Markers: `BLU-API-0002`, `BLU-OBS-0001`
- Objective: Cross-device key storage via GitHub Gist + Anthropic usage visibility.
- Work completed:
  - Created `web/src/utils/gist.js` — `loadSettingsFromGist` / `saveSettingsToGist` using Octokit (already installed). Stores `{tmdb, anthropic}` in a private secret Gist called `bluray-app-settings`.
  - App.jsx: auto-syncs from Gist on first mount when GitHub token present; Save pushes to Gist in background. Settings screen shows sync status (`✓ Synced`, `⚠ Sync failed` + Retry).
  - useLookup.js: `parseAnthropicError()` maps API error types to actionable user messages (bad key, exhausted credits, rate limit, overload). Cover scan counter in localStorage (`bluray_cover_usage`) with monthly reset, exposed as `coverUsage`.
  - Scanner.jsx: Cover tab shows `~N scans this month · est. $X.XXX`.
- Decisions made: No DEC file needed — straightforward extension of existing localStorage pattern, low security risk for personal app.
- Open issues/blockers: None.
- Next actions: Test Gist sync end-to-end on a second device once Anthropic key is obtained. Consider genre/tagline display in MovieDetail/MovieCard now that enrichment populates those fields.
- References: BLU-API-0001, BLU-API-0002, BLU-OBS-0001

---

### 2026-04-24 - Session 3

- Markers: `BLU-DX-0003`, `BLU-FIX-0002`, `BLU-DATA-0001`, `BLU-API-0001`
- Objective: Codebase improvements across lookup logic, enrichment, CI, and add Claude cover photo identification.
- Work completed:
  - enrich.yml: added `[skip ci]` to enrichment commit — stops recursive CI trigger.
  - App.jsx: extracted all lookup/fetch/cache logic into `hooks/useLookup.js`; pure utilities promoted to `utils/movies.js`. App.jsx reduced from 860 to 250 lines.
  - App.jsx: removed dead UPC chunk fallback; fixed redundant Open DB double-call.
  - details_scraper.py: added `genres` and `tagline` fields to enrichment output.
  - MovieCard: improved no-poster placeholder to show title and year.
  - requirements.txt: replaced ML env dump with just `requests`; same for `scripts/requirements.txt`.
  - Claude cover photo: new `identifyFromCover()` in useLookup — compresses via canvas, calls Anthropic Haiku API, parses JSON response, feeds title into TMDB search. Settings screen adds Anthropic API key field. Scanner gains a Cover Photo tab (locked with explanatory message when no key set).
- Decisions made: Anthropic key stored in localStorage (same pattern as TMDB/GitHub token — personal app, acceptable risk).
- Open issues/blockers: None.
- Next actions: Add cross-device key sync and usage tracking (covered in Session 4).
- References: BLU-DX-0003, BLU-FIX-0002, BLU-DATA-0001, BLU-API-0001

---

### 2026-04-24 - Session 2

- Markers: `BLU-ARCH-0001`, `BLU-FIX-0001`, `BLU-DX-0002`
- Objective: Sync both repos and clean up stale artifacts and code duplication.
- Work completed:
  - Pulled `bluray` to latest (4 commits ahead: auto-enrich + add/remove movies).
  - Wired `bluray-database` local clone to `github.com/solfood/bluray-database` (master branch) — it had full pipeline content on GitHub but was never connected locally.
  - Removed `database_files` git submodule from `bluray` — it was a stale disconnected copy; the live pipeline lives in `bluray-database`.
  - Extracted `moviesMatch` to `web/src/utils/movies.js`; removed duplicate definitions from `App.jsx` and `github.js`.
  - Moved `tmdb_checker.py` to `scripts/`; deleted `test_scrape.py` (scratch file).
- Decisions made: No new DEC files needed — all changes are low risk, no non-obvious design choices.
- Open issues/blockers: `scripts/enrich_library.py` (old blu-ray.com DuckDuckGo scraper) is not connected to any workflow and may be dead code — worth evaluating next session.
- Next actions: Consider BLU-DX-0003 (extract `useLookup` hook from App.jsx) if the file grows further. Push changes to origin.
- References: BLU-ARCH-0001, BLU-FIX-0001, BLU-DX-0002

---

### 2026-04-24 - Session 1

- Markers: `BLU-DX-0001`
- Objective: Bootstrap the engineering scaffold onto the bluray repo.
- Work completed: Created CLAUDE.md, policies/project-policy.yaml, docs/work-index.md, docs/session-log.md, docs/decisions/DEC-0001.md. Added docs/experiments/ placeholder. This is a cross-cutting item across the Solfood GitHub Pages suite (SUITE-DX-0001).
- Verification: All placeholder values replaced; scaffold structure matches engineering-scaffold-template. Policy reflects actual tech stack (React, Vite, Tailwind, Octokit, Python TMDB scraper). `suite` block correctly references Willowbrook and recipes-wiki.
- Decisions made: DEC-0001 — adopt engineering scaffold for AI-assisted development. Low risk.
- Open issues/blockers: None.
- Next actions: Start next real work item — scan codebase for improvements (candidate: GitHub token handling UX, TMDB rate-limit resilience, or Node version consistency in deploy.yml).
- References: engineering-scaffold-template, SUITE-DX-0001

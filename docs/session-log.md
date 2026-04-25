# Session Log

Append-only continuity log.

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

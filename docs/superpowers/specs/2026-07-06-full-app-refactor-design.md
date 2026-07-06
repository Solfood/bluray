# Full-App Refactor: Static SPA → Self-Hosted React Router v7 App

- Date: 2026-07-06
- Marker: BLU-ARCH-0002
- Decision record: DEC-0002
- Status: approved (design), pending threat model (Gate 2) before build

## Goal

Replace the static React SPA + git-as-database architecture with a single
self-hosted full-stack app: React Router v7 (framework mode) with a SQLite
database, running as one Docker container on the home server behind
`bluray.local`. Git/GitHub stops being the database and becomes a code repo
plus an automated backup target.

## Motivations (confirmed with owner)

1. Kill the GitHub-as-database setup — browser writes via Octokit with a
   personal GitHub token in localStorage are fragile and the token is a
   critical asset sitting in the browser.
2. New capabilities that need a server — instant server-side enrichment,
   server-proxied scan/identify, richer library features.
3. The site is already self-hosted (Docker-capable home server), so a real
   backend is now possible.

Non-motivations: local poster/image hosting (explicitly deferred), multi-user
access, remote access. Single user, LAN only.

## Architecture

One React Router v7 app in framework mode: a single Node process that
server-renders the UI, exposes loaders/actions as the API layer, and owns a
SQLite database. Deployed as one Docker container with a mounted `/data`
volume (SQLite file + JSON exports).

- **No auth.** LAN-only, single user, per owner's explicit decision.
- **Secrets move server-side.** TMDB key, Anthropic key, and a GitHub token
  (backup pushes only) become server env vars. The browser-side secret
  machinery — localStorage keys, the Gist settings vault (`utils/gist.js`),
  Octokit-in-browser (`utils/github.js`) — is deleted, not ported.
- **Data flow inverts.** Loaders read from SQLite; actions write to it; the
  server calls TMDB/Anthropic on the user's behalf.

## Repo restructure

Retired: `web/` wrapper, `details_scraper.py`, `tmdb_checker.py`, `scripts/`,
both Python `requirements.txt` files, the enrichment GitHub Actions workflow.

New shape:

```
app/
  routes/          home (grid + genre/text filters), movie.$id, scanner, api.*
  components/      MovieCard, MovieGrid, MovieDetail, Scanner — ported from web/
server/
  db/              schema, migrations, one-time movies.json import script
  services/        tmdb.ts, identify.ts (Claude cover ID), enrich.ts, backup.ts
Dockerfile
```

Vite, React, and Tailwind carry over; existing components port with minimal
churn. `hooks/useLookup.js` is replaced by loaders/actions; its TMDB logic
moves into `server/services/tmdb.ts`. The enrichment logic in
`details_scraper.py` (TMDB details, credits, release info, genres, tagline)
is ported once to `server/services/enrich.ts`.

## Data model

- `movies` table mirroring today's `movies.json` fields, plus:
  `watch_status` (unwatched/watched), `personal_rating`, `loaned_to`,
  `loaned_at`, `added_at`, `enrichment_status` (pending/done/failed).
- `scan_usage` table replaces the localStorage Anthropic usage counter.
- SQLite FTS5 index over title/overview/cast for full-text search.
- Stats (counts, by-genre, by-decade) are queries only — a `/stats` route can
  be added later with no schema change.
- SQLite runs in WAL mode; all writes go through a single synchronous
  connection (better-sqlite3), avoiding locking/corruption scenarios at
  single-user scale.

## Key flows

- **Add movie:** Scanner identifies (barcode, or cover photo via
  server-proxied Claude) → action inserts the row and responds immediately →
  in-process async enrichment fills details → UI revalidates; details appear
  in seconds. Enrichment status lives on the row with a visible retry on
  failure. No GitHub Actions round-trip.
- **Backup:** nightly in-process job exports canonical `movies.json` to
  `/data/exports/` and pushes it to the GitHub repo with a server-side token.
  The export format stays byte-compatible with today's `movies.json` schema.
- **Migration:** one-time script imports the current `movies.json` into
  SQLite. Lossless round-trip (import → export → byte-comparable JSON) is a
  required test.

## Error handling

- External API failures: services return typed errors; routes translate them
  to actionable messages (the `parseAnthropicError` mapping generalizes and
  moves server-side). Enrichment failure never loses a movie — the row is
  already saved with `enrichment_status: failed` and a retry button.
- Trust boundaries: actions validate inputs even LAN-only — barcode format,
  image size/type caps before the Claude call, field whitelisting on edits.
- Backup failures: logged and surfaced as a "last backup: N days ago"
  indicator in the UI footer; never silent.

## Testing

- Vitest unit tests for the services layer: enrichment mapping of TMDB
  responses → schema, error translation, export format.
- Integration test: run the real migration script against a copy of the
  actual `movies.json`, assert lossless import → export round-trip. This is
  the load-bearing test protecting the `movies_json` critical asset.
- UI smoke test only; no component-test ceremony.

## Cutover and rollback

1. Build the new app on a branch; the static site at `bluray.local` stays
   untouched and working.
2. Deploy the container to a different port (e.g. `bluray.local:3000`),
   import a copy of `movies.json`, run both in parallel for a few days.
3. Cutover = pointing the web server at the container. Rollback = pointing it
   back; git `movies.json` is still current at cutover because nothing wrote
   to the new DB canonically until then.
4. The old `web/` code is deleted only after the first successful automated
   backup push.

## Process

Medium risk (touches `movies_json`, `github_token`, `tmdb_api_key`; includes
a data migration). Gate 2 (threat model) is required before BUILD begins.
Marker: BLU-ARCH-0002. Decision record: DEC-0002.

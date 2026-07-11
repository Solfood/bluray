# Full-App Refactor Implementation Plan (BLU-ARCH-0002)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static SPA + git-as-database architecture with one self-hosted React Router v7 app owning a SQLite database, deployed as a single Docker container.

**Architecture:** RRv7 framework mode at the repo root: `app/` holds routes/components (ported from `web/src/`), `server/` holds the DB layer and services (TMDB lookup, Claude cover ID, enrichment, GitHub backup). Resource routes under `/api/*` are the API; the home route is a port of today's `App.jsx` state machine with all secret/GitHub plumbing deleted. SQLite (better-sqlite3, WAL) lives on a `/data` volume; a scheduler exports `movies.json` nightly and pushes it to GitHub.

**Tech Stack:** React Router 7, React 19, Vite 7, Tailwind 4 (`@tailwindcss/vite`), better-sqlite3, Vitest, html5-qrcode, Docker.

**Spec:** `docs/superpowers/specs/2026-07-06-full-app-refactor-design.md` · **Threat model:** `docs/threat-models/TM-0001.md`

## Global Constraints

- Node >= 22. New server code is TypeScript; ported components stay `.jsx` (tsconfig `allowJs: true`).
- The old app must keep working throughout: **do not modify or delete anything under `web/`,** `details_scraper.py`, or `.github/workflows/` in this plan. Retirement is a post-cutover follow-up.
- No secrets in the repo. Server reads: `TMDB_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`, `DATA_DIR`, `SCAN_MONTHLY_CAP`. Never log key material; never include request headers in thrown errors.
- Every `/api/*` route validates input (TM-0001): field whitelists, length caps, image size/type caps, hard monthly scan cap.
- Export format: `{"movies": [...]}` — parsed-JSON **deep-equal** to the source after import→export round-trip (key presence preserved, `""` ≠ absent, numeric-string ids like `1422` export as numbers, `manual-*` ids stay strings). New personal fields (`watch_status`, `personal_rating`, `loaned_to`, `loaned_at`) are exported only when non-default, so the real 41-movie file round-trips unchanged.
- Backup commits use message suffix `[skip ci]`.
- All commits reference `BLU-ARCH-0002`.
- Existing `status` column doubles as enrichment status: `pending_enrichment | enriched | needs_tmdb_match | enrich_failed` (last value is new, additive).

---

### Task 1: Scaffold the RRv7 app at the repo root

**Files:**
- Create: `package.json`, `vite.config.ts`, `react-router.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.dockerignore`
- Create: `app/routes.ts`, `app/root.tsx`, `app/app.css`, `app/routes/home.jsx` (placeholder)
- Create: `server/smoke.test.ts`
- Modify: `.gitignore` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run dev|build|test` working from repo root; route table registering `routes/home.jsx` and all `/api/*` paths used by later tasks.

- [x] **Step 1: Write config files**

`package.json`:

```json
{
  "name": "bluray-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "react-router dev",
    "build": "react-router build",
    "start": "react-router-serve ./build/server/index.js",
    "test": "vitest run",
    "import": "tsx server/db/import-cli.ts"
  },
  "dependencies": {
    "@react-router/node": "^7.6.0",
    "@react-router/serve": "^7.6.0",
    "better-sqlite3": "^12.0.0",
    "html5-qrcode": "^2.3.8",
    "isbot": "^5.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router": "^7.6.0"
  },
  "devDependencies": {
    "@react-router/dev": "^7.6.0",
    "@tailwindcss/vite": "^4.1.18",
    "@types/better-sqlite3": "^7.6.0",
    "@types/react": "^19.2.5",
    "@types/react-dom": "^19.2.3",
    "tailwindcss": "^4.1.18",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vite": "^7.2.4",
    "vitest": "^3.2.0"
  }
}
```

`vite.config.ts`:

```ts
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
});
```

`react-router.config.ts`:

```ts
import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
} satisfies Config;
```

`tsconfig.json`:

```json
{
  "include": ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  "exclude": ["node_modules", "build", "web"],
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2023"],
    "types": ["vite/client"],
    "target": "ES2023",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "allowJs": true,
    "checkJs": false,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "paths": { "~/*": ["./app/*"] },
    "baseUrl": "."
  }
}
```

`vitest.config.ts` (separate from Vite config so the RR plugin doesn't load in tests):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'app/**/*.test.js'],
  },
});
```

`.dockerignore`:

```
node_modules
build
data
web
docs
policies
scripts
.git
.github
*.py
```

Append to `.gitignore`:

```
node_modules/
build/
data/
.env
```

- [x] **Step 2: Write app shell**

`app/routes.ts` (full route table now; later tasks fill the files in):

```ts
import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.jsx'),
  route('api/lookup', 'routes/api.lookup.ts'),
  route('api/identify', 'routes/api.identify.ts'),
  route('api/movies', 'routes/api.movies.ts'),
  route('api/movies/:pk', 'routes/api.movies.$pk.ts'),
  route('api/movies/:pk/enrich', 'routes/api.movies.$pk.enrich.ts'),
] satisfies RouteConfig;
```

For this task, create stub files for the five `api.*` routes so the build passes, each containing only:

```ts
export async function loader() {
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
```

(`api.movies.ts`, `api.movies.$pk.ts`, `api.movies.$pk.enrich.ts`, `api.identify.ts` export the same body as `action` instead of `loader`; `api.lookup.ts` uses `loader`.)

`app/root.tsx`:

```tsx
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import './app.css';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-gray-900">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>My Collection</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
```

`app/app.css`: run `cp web/src/index.css app/app.css`, then ensure the file starts with `@import "tailwindcss";` (replace any `@tailwind base/components/utilities` directives if present), then append the contents of `web/src/App.css`.

`app/routes/home.jsx` (placeholder, replaced in Task 9):

```jsx
export default function Home() {
  return <div className="min-h-screen bg-gray-900 text-white p-8">bluray app scaffold</div>;
}
```

- [x] **Step 3: Write the smoke test**

`server/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('scaffold', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [x] **Step 4: Install and verify**

Run: `npm install`
Run: `npm test` — Expected: 1 test passes.
Run: `npm run build` — Expected: build completes, `build/server/index.js` and `build/client/` exist.
Run: `npm run dev` in background, `curl -s http://localhost:3000 | grep "bluray app scaffold"` — Expected: match. Stop the dev server.

- [x] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts react-router.config.ts tsconfig.json vitest.config.ts .dockerignore .gitignore app/ server/
git commit -m "BLU-ARCH-0002: Scaffold React Router v7 app at repo root"
```

---

### Task 2: Database layer — schema, connection, record mapping

**Files:**
- Create: `server/db/index.ts`, `server/db/movies.ts`
- Test: `server/db/movies.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createDb(dbPath: string): Database` — opens/migrates a SQLite file (used by tests and CLI).
  - `getDb(): Database` — process singleton at `$DATA_DIR/bluray.db` (default `./data/bluray.db`).
  - `rowToRecord(row): object` — export/legacy shape (skips NULLs, id type rule, non-default personal fields only).
  - `rowToApi(row): object` — record plus always-present `pk`, `watch_status`, `personal_rating`, `loaned_to`, `loaned_at`.
  - `recordToRow(record): object` — inverse of rowToRecord for insertion.
  - `insertMovie(db, record): number` (returns pk), `getMovie(db, pk)`, `listMovies(db)` (added_at DESC), `updateMovie(db, pk, fields)`, `deleteMovie(db, pk)`, `searchMovies(db, q)` (FTS5), `getMeta(db, key): string | null`, `setMeta(db, key, value)`.

- [x] **Step 1: Write failing tests**

`server/db/movies.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from './index';
import {
  rowToRecord, rowToApi, recordToRow,
  insertMovie, getMovie, listMovies, updateMovie, deleteMovie, searchMovies,
  getMeta, setMeta,
} from './movies';

const SAMPLE = {
  id: 1422, tmdb_id: 1422, title: 'The Departed',
  poster_path: '/nT97ifVT2J1yMQmeq20Qblg61T.jpg', release_date: '2006-10-04',
  overview: 'Undercover cops.', upc: 'The Departed',
  added_at: '2026-04-25T21:27:37.182Z', note: '4K Ultra HD', status: 'enriched',
  match_source: 'tmdb', match_score: 147, runtime: 151,
  production_countries: ['HK', 'US'], audio_tracks: ['English', 'Cantonese'],
  genres: ['Drama', 'Thriller', 'Crime'], tagline: 'Cops or criminals.',
  enriched_at: '2026-04-25T21:27:48.544954',
};

let db: ReturnType<typeof createDb>;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluray-test-'));
  db = createDb(path.join(dir, 'test.db'));
});

describe('record mapping', () => {
  it('round-trips a full record losslessly', () => {
    const pk = insertMovie(db, SAMPLE);
    expect(rowToRecord(getMovie(db, pk))).toEqual(SAMPLE);
  });

  it('preserves absent fields as absent and empty strings as empty', () => {
    const sparse = { id: 'manual-123', title: 'X', added_at: '2026-01-01T00:00:00.000Z', note: '' };
    const pk = insertMovie(db, sparse);
    const rec = rowToRecord(getMovie(db, pk));
    expect(rec).toEqual(sparse);
    expect('genres' in rec).toBe(false);
    expect(rec.note).toBe('');
  });

  it('exports numeric-string ids as numbers, manual ids as strings', () => {
    const a = insertMovie(db, { id: 1422, title: 'A', added_at: '2026-01-01T00:00:00.000Z' });
    const b = insertMovie(db, { id: 'manual-99', title: 'B', added_at: '2026-01-02T00:00:00.000Z' });
    expect(rowToRecord(getMovie(db, a)).id).toBe(1422);
    expect(rowToRecord(getMovie(db, b)).id).toBe('manual-99');
  });

  it('omits default personal fields from records but always includes them in API shape', () => {
    const pk = insertMovie(db, { id: 1, title: 'A', added_at: '2026-01-01T00:00:00.000Z' });
    expect('watch_status' in rowToRecord(getMovie(db, pk))).toBe(false);
    const api = rowToApi(getMovie(db, pk));
    expect(api.pk).toBe(pk);
    expect(api.watch_status).toBe('unwatched');
    expect(api.personal_rating).toBeNull();
  });

  it('includes non-default personal fields in exported records', () => {
    const pk = insertMovie(db, { id: 1, title: 'A', added_at: '2026-01-01T00:00:00.000Z' });
    updateMovie(db, pk, { watch_status: 'watched', personal_rating: 8, loaned_to: 'Sam', loaned_at: '2026-07-01T00:00:00.000Z' });
    const rec = rowToRecord(getMovie(db, pk));
    expect(rec.watch_status).toBe('watched');
    expect(rec.personal_rating).toBe(8);
    expect(rec.loaned_to).toBe('Sam');
  });
});

describe('crud + search + meta', () => {
  it('lists newest first, updates whitelisted fields, deletes', () => {
    const a = insertMovie(db, { id: 1, title: 'Old', added_at: '2026-01-01T00:00:00.000Z' });
    const b = insertMovie(db, { id: 2, title: 'New', added_at: '2026-06-01T00:00:00.000Z' });
    expect(listMovies(db).map((r) => r.pk)).toEqual([b, a]);
    updateMovie(db, a, { note: 'Steelbook' });
    expect(getMovie(db, a).note).toBe('Steelbook');
    deleteMovie(db, a);
    expect(getMovie(db, a)).toBeUndefined();
    expect(listMovies(db)).toHaveLength(1);
  });

  it('full-text searches title and overview, survives quotes', () => {
    insertMovie(db, { id: 1, title: 'The Departed', overview: 'Irish mafia mole', added_at: '2026-01-01T00:00:00.000Z' });
    insertMovie(db, { id: 2, title: 'In Bruges', overview: 'Hitmen hide in Belgium', added_at: '2026-01-02T00:00:00.000Z' });
    expect(searchMovies(db, 'mafia').map((r) => r.title)).toEqual(['The Departed']);
    expect(searchMovies(db, 'brug')).toHaveLength(1); // prefix match
    expect(searchMovies(db, 'a"b')).toEqual([]); // no crash on quotes
  });

  it('stores and reads meta', () => {
    expect(getMeta(db, 'last_backup_at')).toBeNull();
    setMeta(db, 'last_backup_at', '2026-07-06T00:00:00.000Z');
    expect(getMeta(db, 'last_backup_at')).toBe('2026-07-06T00:00:00.000Z');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/db` — Expected: FAIL (modules don't exist).

- [x] **Step 3: Implement**

`server/db/index.ts`:

```ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE movies (
  pk INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  tmdb_id INTEGER,
  title TEXT NOT NULL,
  poster_path TEXT,
  release_date TEXT,
  overview TEXT,
  upc TEXT,
  added_at TEXT NOT NULL,
  note TEXT,
  status TEXT,
  match_source TEXT,
  match_score INTEGER,
  runtime INTEGER,
  production_countries TEXT,
  audio_tracks TEXT,
  genres TEXT,
  tagline TEXT,
  enriched_at TEXT,
  watch_status TEXT NOT NULL DEFAULT 'unwatched',
  personal_rating INTEGER,
  loaned_to TEXT,
  loaned_at TEXT
);

CREATE VIRTUAL TABLE movies_fts USING fts5(
  title, overview, tagline, note,
  content='movies', content_rowid='pk'
);

CREATE TRIGGER movies_ai AFTER INSERT ON movies BEGIN
  INSERT INTO movies_fts(rowid, title, overview, tagline, note)
  VALUES (new.pk, new.title, new.overview, new.tagline, new.note);
END;
CREATE TRIGGER movies_ad AFTER DELETE ON movies BEGIN
  INSERT INTO movies_fts(movies_fts, rowid, title, overview, tagline, note)
  VALUES ('delete', old.pk, old.title, old.overview, old.tagline, old.note);
END;
CREATE TRIGGER movies_au AFTER UPDATE ON movies BEGIN
  INSERT INTO movies_fts(movies_fts, rowid, title, overview, tagline, note)
  VALUES ('delete', old.pk, old.title, old.overview, old.tagline, old.note);
  INSERT INTO movies_fts(rowid, title, overview, tagline, note)
  VALUES (new.pk, new.title, new.overview, new.tagline, new.note);
END;

CREATE TABLE scan_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0.001
);
CREATE INDEX scan_usage_month ON scan_usage(month);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function createDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version === 0) {
    db.exec(SCHEMA);
    db.pragma('user_version = 1');
  }
  return db;
}

declare global {
  // eslint-disable-next-line no-var
  var __blurayDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!globalThis.__blurayDb) {
    const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    globalThis.__blurayDb = createDb(path.join(dir, 'bluray.db'));
  }
  return globalThis.__blurayDb;
}
```

`server/db/movies.ts`:

```ts
import type { Database } from 'better-sqlite3';

export const LEGACY_FIELDS = [
  'id', 'tmdb_id', 'title', 'poster_path', 'release_date', 'overview', 'upc',
  'added_at', 'note', 'status', 'match_source', 'match_score', 'runtime',
  'production_countries', 'audio_tracks', 'genres', 'tagline', 'enriched_at',
] as const;

const JSON_FIELDS = new Set(['production_countries', 'audio_tracks', 'genres']);
const UPDATABLE_FIELDS = new Set([
  'note', 'status', 'overview', 'runtime', 'production_countries', 'audio_tracks',
  'genres', 'tagline', 'enriched_at',
  'watch_status', 'personal_rating', 'loaned_to', 'loaned_at',
]);

export function rowToRecord(row: any): any {
  const record: any = {};
  for (const f of LEGACY_FIELDS) {
    const v = row[f];
    if (v === null || v === undefined) continue;
    if (f === 'id') record.id = /^\d+$/.test(v) ? Number(v) : v;
    else if (JSON_FIELDS.has(f)) record[f] = JSON.parse(v);
    else record[f] = v;
  }
  if (row.watch_status && row.watch_status !== 'unwatched') record.watch_status = row.watch_status;
  if (row.personal_rating !== null && row.personal_rating !== undefined) record.personal_rating = row.personal_rating;
  if (row.loaned_to !== null && row.loaned_to !== undefined) {
    record.loaned_to = row.loaned_to;
    if (row.loaned_at !== null && row.loaned_at !== undefined) record.loaned_at = row.loaned_at;
  }
  return record;
}

export function rowToApi(row: any): any {
  return {
    ...rowToRecord(row),
    pk: row.pk,
    watch_status: row.watch_status ?? 'unwatched',
    personal_rating: row.personal_rating ?? null,
    loaned_to: row.loaned_to ?? null,
    loaned_at: row.loaned_at ?? null,
  };
}

export function recordToRow(record: any): any {
  const row: any = {};
  for (const f of LEGACY_FIELDS) {
    const v = record[f];
    if (v === undefined) { row[f] = null; continue; }
    if (f === 'id') row.id = String(v);
    else if (JSON_FIELDS.has(f)) row[f] = JSON.stringify(v);
    else row[f] = v;
  }
  row.watch_status = record.watch_status ?? 'unwatched';
  row.personal_rating = record.personal_rating ?? null;
  row.loaned_to = record.loaned_to ?? null;
  row.loaned_at = record.loaned_at ?? null;
  return row;
}

const ALL_COLUMNS = [...LEGACY_FIELDS, 'watch_status', 'personal_rating', 'loaned_to', 'loaned_at'];

export function insertMovie(db: Database, record: any): number {
  const row = recordToRow(record);
  const cols = ALL_COLUMNS.join(', ');
  const params = ALL_COLUMNS.map((c) => `@${c}`).join(', ');
  const result = db.prepare(`INSERT INTO movies (${cols}) VALUES (${params})`).run(row);
  return Number(result.lastInsertRowid);
}

export function getMovie(db: Database, pk: number): any {
  return db.prepare('SELECT * FROM movies WHERE pk = ?').get(pk);
}

export function listMovies(db: Database): any[] {
  return db.prepare('SELECT * FROM movies ORDER BY added_at DESC, pk DESC').all();
}

export function updateMovie(db: Database, pk: number, fields: Record<string, any>): void {
  const entries = Object.entries(fields).filter(([k]) => UPDATABLE_FIELDS.has(k));
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
  const params: any = { pk };
  for (const [k, v] of entries) {
    params[k] = JSON_FIELDS.has(k) && v !== null ? JSON.stringify(v) : v;
  }
  db.prepare(`UPDATE movies SET ${sets} WHERE pk = @pk`).run(params);
}

export function deleteMovie(db: Database, pk: number): void {
  db.prepare('DELETE FROM movies WHERE pk = ?').run(pk);
}

export function searchMovies(db: Database, q: string): any[] {
  const terms = q.trim().split(/\s+/).filter(Boolean).slice(0, 8)
    .map((t) => `"${t.replace(/"/g, '')}"*`);
  if (terms.length === 0) return [];
  try {
    return db.prepare(
      `SELECT m.* FROM movies m JOIN movies_fts f ON m.pk = f.rowid
       WHERE movies_fts MATCH ? ORDER BY rank`
    ).all(terms.join(' '));
  } catch {
    return [];
  }
}

export function getMeta(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as any;
  return row ? row.value : null;
}

export function setMeta(db: Database, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/db` — Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add server/db/
git commit -m "BLU-ARCH-0002: SQLite layer — schema, FTS5, record mapping, CRUD"
```

---

### Task 3: Import/export with round-trip guarantee + import CLI

**Files:**
- Create: `server/db/transfer.ts`, `server/db/import-cli.ts`
- Test: `server/db/transfer.test.ts`

**Interfaces:**
- Consumes: Task 2 (`createDb`, `insertMovie`, `listMovies`, `rowToRecord`).
- Produces:
  - `importMoviesJson(db, jsonText: string): number` — inserts all records in file order, returns count. Strips personal fields if present in input (they're DB-owned).
  - `exportMoviesJson(db): string` — `JSON.stringify({ movies }, null, 2)`, movies ordered by pk (= original file order after import).
  - `npm run import -- <path>` CLI (refuses to run on a non-empty DB without `--force`).

- [x] **Step 1: Write failing tests**

`server/db/transfer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './index';
import { importMoviesJson, exportMoviesJson } from './transfer';

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluray-test-'));
  return createDb(path.join(dir, 'test.db'));
}

describe('import/export', () => {
  it('round-trips the REAL movies.json losslessly (deep equal)', () => {
    const realPath = fileURLToPath(new URL('../../movies.json', import.meta.url));
    const original = fs.readFileSync(realPath, 'utf8');
    const db = freshDb();
    const count = importMoviesJson(db, original);
    expect(count).toBe(JSON.parse(original).movies.length);
    expect(JSON.parse(exportMoviesJson(db))).toEqual(JSON.parse(original));
  });

  it('preserves record order', () => {
    const db = freshDb();
    const input = JSON.stringify({
      movies: [
        { id: 2, title: 'Second-added but listed first', added_at: '2026-06-01T00:00:00.000Z' },
        { id: 1, title: 'First-added but listed second', added_at: '2026-01-01T00:00:00.000Z' },
      ],
    });
    importMoviesJson(db, input);
    const out = JSON.parse(exportMoviesJson(db));
    expect(out.movies.map((m: any) => m.id)).toEqual([2, 1]);
  });

  it('rejects invalid shapes', () => {
    const db = freshDb();
    expect(() => importMoviesJson(db, '{"nope": true}')).toThrow(/movies/);
    expect(() => importMoviesJson(db, JSON.stringify({ movies: [{ id: 1 }] }))).toThrow(/title/);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/db/transfer.test.ts` — Expected: FAIL (module doesn't exist).

- [x] **Step 3: Implement**

`server/db/transfer.ts`:

```ts
import type { Database } from 'better-sqlite3';
import { insertMovie, rowToRecord } from './movies';

export function importMoviesJson(db: Database, jsonText: string): number {
  const data = JSON.parse(jsonText);
  if (!Array.isArray(data?.movies)) throw new Error('Input must be an object with a movies array');
  const insertAll = db.transaction((movies: any[]) => {
    for (const movie of movies) {
      if (movie.id === undefined || movie.id === null) throw new Error(`Movie missing id: ${JSON.stringify(movie).slice(0, 80)}`);
      if (typeof movie.title !== 'string' || !movie.title) throw new Error(`Movie ${movie.id} missing title`);
      if (typeof movie.added_at !== 'string' || !movie.added_at) throw new Error(`Movie ${movie.id} missing added_at`);
      insertMovie(db, movie);
    }
  });
  insertAll(data.movies);
  return data.movies.length;
}

export function exportMoviesJson(db: Database): string {
  const rows = db.prepare('SELECT * FROM movies ORDER BY pk').all();
  return JSON.stringify({ movies: rows.map(rowToRecord) }, null, 2);
}
```

`server/db/import-cli.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './index';
import { importMoviesJson } from './transfer';

const args = process.argv.slice(2).filter((a) => a !== '--force');
const force = process.argv.includes('--force');
const file = args[0] || path.resolve(process.cwd(), 'movies.json');

const db = getDb();
const existing = (db.prepare('SELECT COUNT(*) AS n FROM movies').get() as any).n;
if (existing > 0 && !force) {
  console.error(`Database already has ${existing} movies. Re-run with --force to import anyway.`);
  process.exit(1);
}

const count = importMoviesJson(db, fs.readFileSync(file, 'utf8'));
console.log(`Imported ${count} movies from ${file}`);
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/db` — Expected: all PASS, including the real-file round trip.

- [x] **Step 5: Commit**

```bash
git add server/db/
git commit -m "BLU-ARCH-0002: movies.json import/export with lossless round-trip test"
```

---

### Task 4: Port shared matching utilities

**Files:**
- Create: `app/lib/movies.js` (copy of `web/src/utils/movies.js`, unchanged)
- Test: `app/lib/movies.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeTitle`, `cleanProductTitle`, `buildTitleVariants`, `safeYear`, `normalizeScanOrInput`, `buildUpcCandidates`, `sortMoviesNewestFirst`, `scoreMovieCandidate`, `moviesMatch` — exact same signatures as `web/src/utils/movies.js` (used by both server services and client UI).

- [x] **Step 1: Copy the module**

Run: `mkdir -p app/lib && cp web/src/utils/movies.js app/lib/movies.js` — no edits.

- [x] **Step 2: Write tests (this module never had any)**

`app/lib/movies.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  normalizeTitle, buildTitleVariants, safeYear, normalizeScanOrInput,
  buildUpcCandidates, scoreMovieCandidate, moviesMatch,
} from './movies';

describe('matching utils', () => {
  it('normalizes titles', () => {
    expect(normalizeTitle('The Matrix (4K UHD) [Steelbook]')).toBe('the matrix');
  });

  it('builds title variants from noisy product titles', () => {
    const variants = buildTitleVariants('Inception 4K Ultra HD Blu-ray Steelbook');
    expect(variants).toContain('Inception');
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it('parses safe years', () => {
    expect(safeYear('2006-10-04')).toBe(2006);
    expect(safeYear('n/a')).toBeNull();
  });

  it('normalizes scans: 8+ digits become bare digits, else raw text', () => {
    expect(normalizeScanOrInput(' 8-8392-98008-15 ')).toBe('883929800815');
    expect(normalizeScanOrInput('In Bruges')).toBe('In Bruges');
  });

  it('builds UPC candidates with EAN/UPC zero-padding variants', () => {
    expect(buildUpcCandidates('0883929800815')).toEqual(['0883929800815', '883929800815']);
    expect(buildUpcCandidates('883929800815')).toEqual(['883929800815', '0883929800815']);
  });

  it('scores exact title+year matches highest', () => {
    const exact = scoreMovieCandidate({ title: 'The Departed', release_date: '2006-10-04' }, 'The Departed', 2006);
    const off = scoreMovieCandidate({ title: 'Departure', release_date: '2019-01-01' }, 'The Departed', 2006);
    expect(exact).toBeGreaterThan(120);
    expect(exact).toBeGreaterThan(off);
  });

  it('matches movies on added_at, upc+title, or id+title', () => {
    expect(moviesMatch({ added_at: 'x' }, { added_at: 'x' })).toBe(true);
    expect(moviesMatch({ id: 1, title: 'A' }, { id: 1, title: 'B' })).toBe(false);
  });
});
```

- [x] **Step 3: Run tests**

Run: `npx vitest run app/lib` — Expected: all PASS (implementation already exists; if any expectation mismatches actual behavior, fix the TEST — this module's behavior is the contract, do not change `movies.js`).

- [x] **Step 4: Commit**

```bash
git add app/lib/
git commit -m "BLU-ARCH-0002: port shared matching utils with new unit tests"
```

---

### Task 5: TMDB + lookup services (server-side port of useLookup's search flow)

**Files:**
- Create: `server/services/tmdb.ts`, `server/services/lookup.ts`
- Test: `server/services/lookup.test.ts`

**Interfaces:**
- Consumes: Task 4 utils (`~/lib/movies.js` — configure the `~` alias for server files via relative import `../../app/lib/movies.js`).
- Produces:
  - `tmdb.ts`: `tmdbGet(pathAndQuery: string): Promise<any|null>` (adds api_key, retries 5xx twice with backoff, 7s timeout, returns null on 4xx), `searchMovie(query): Promise<any[]>`, `findByUpc(upc): Promise<any[]>`, `getMovieDetails(tmdbId): Promise<any|null>` (with `append_to_response=release_dates,credits`).
  - `lookup.ts`: `lookupQuery(query: string): Promise<{ status: string, candidates: any[], detectedEdition: string }>` and `lookupByIdentifiedTitle(title: string, year: number|null): Promise<any[]>`. Candidates carry `_score`/`_source` exactly like today's client code so the UI port is drop-in.

- [x] **Step 1: Write failing tests**

`server/services/lookup.test.ts` (stub global fetch; no live network):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lookupQuery } from './lookup';

const tmdbSearchResponse = {
  results: [
    { id: 1422, title: 'The Departed', release_date: '2006-10-04', overview: 'Mole.', poster_path: '/x.jpg' },
    { id: 999, title: 'Departure', release_date: '2019-05-01', overview: 'Other.', poster_path: null },
  ],
};

beforeEach(() => {
  process.env.TMDB_API_KEY = 'test-key';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/search/movie')) return new Response(JSON.stringify(tmdbSearchResponse));
    if (u.includes('/find/')) return new Response(JSON.stringify({ movie_results: [] }));
    // Open DB indexes + upcitemdb: not found
    return new Response('not found', { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lookupQuery', () => {
  it('title search returns ranked candidates with _score and _source', async () => {
    const result = await lookupQuery('The Departed');
    expect(result.candidates[0].title).toBe('The Departed');
    expect(result.candidates[0]._source).toBe('tmdb');
    expect(result.candidates[0]._score).toBeGreaterThan(result.candidates[1]._score);
  });

  it('unmatched title falls back to a manual-entry candidate', async () => {
    (fetch as any).mockImplementation(async () => new Response(JSON.stringify({ results: [] })));
    const result = await lookupQuery('Zzzz Unknown Movie');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]._source).toBe('manual-title');
  });

  it('barcode not found anywhere returns not_found status with no candidates', async () => {
    const result = await lookupQuery('883929800815');
    expect(result.status).toBe('not_found');
    expect(result.candidates).toEqual([]);
  });

  it('caches repeated queries in-memory', async () => {
    await lookupQuery('The Departed cache-test');
    const callsAfterFirst = (fetch as any).mock.calls.length;
    await lookupQuery('The Departed cache-test');
    expect((fetch as any).mock.calls.length).toBe(callsAfterFirst);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/services` — Expected: FAIL (modules don't exist).

- [x] **Step 3: Implement**

`server/services/tmdb.ts`:

```ts
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url: string, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchJsonWithRetry(url: string, retries = 2, backoff = 600, timeoutMs = 7000): Promise<any | null> {
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) {
      if (retries > 0 && res.status >= 500) throw new Error(`Status ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    if (retries > 0) {
      await sleep(backoff);
      return fetchJsonWithRetry(url, retries - 1, Math.floor(backoff * 1.5), timeoutMs);
    }
    throw e;
  }
}

export function tmdbGet(pathAndQuery: string): Promise<any | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return Promise.resolve(null);
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  return fetchJsonWithRetry(`${TMDB_BASE_URL}${pathAndQuery}${sep}api_key=${key}`).catch(() => null);
}

export async function searchMovie(query: string): Promise<any[]> {
  const data = await tmdbGet(`/search/movie?query=${encodeURIComponent(query)}`);
  return data?.results || [];
}

export async function findByUpc(upc: string): Promise<any[]> {
  const data = await tmdbGet(`/find/${upc}?external_source=upc`);
  return data?.movie_results || [];
}

export function getMovieDetails(tmdbId: number): Promise<any | null> {
  return tmdbGet(`/movie/${tmdbId}?append_to_response=release_dates,credits`);
}
```

`server/services/lookup.ts` (port of `useLookup.searchTMDB` minus React state; the in-browser localStorage cache becomes an in-memory Map; upcitemdb is called directly — no CORS proxy needed server-side):

```ts
import {
  normalizeTitle, buildTitleVariants, safeYear,
  normalizeScanOrInput, buildUpcCandidates, scoreMovieCandidate,
} from '../../app/lib/movies.js';
import { searchMovie, findByUpc, fetchJsonWithRetry } from './tmdb';

const OPEN_DB_BASE_URL = 'https://raw.githubusercontent.com/Solfood/bluray-database/main';
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const CACHE_MAX = 120;

const cache = new Map<string, { ts: number; value: LookupResult }>();
let openDbIndexes: { loaded: boolean; upc: any; title: any } = { loaded: false, upc: null, title: null };

export interface LookupResult {
  status: 'ok' | 'not_found';
  candidates: any[];
  detectedEdition: string;
}

async function loadOpenDbIndexes() {
  if (openDbIndexes.loaded) return openDbIndexes;
  const [upcIndex, titleIndex] = await Promise.all([
    fetchJsonWithRetry(`${OPEN_DB_BASE_URL}/upc_index.json`, 1, 500, 6000).catch(() => null),
    fetchJsonWithRetry(`${OPEN_DB_BASE_URL}/title_index.json`, 1, 500, 6000).catch(() => null),
  ]);
  openDbIndexes = {
    loaded: true,
    upc: upcIndex?.index || upcIndex || null,
    title: titleIndex?.index || titleIndex || null,
  };
  return openDbIndexes;
}

async function lookupOpenDbByUpc(rawUpc: string) {
  const variants = buildUpcCandidates(rawUpc);
  if (variants.length === 0) return null;
  const indexes = await loadOpenDbIndexes().catch(() => ({ upc: null } as any));
  if (!indexes?.upc) return null;
  for (const upc of variants) {
    if (indexes.upc[upc]) return { ...indexes.upc[upc], upc, source: 'open-db-index' };
  }
  return null;
}

async function lookupOpenDbByTitle(title: string) {
  const normalized = normalizeTitle(title);
  if (!normalized) return [];
  const indexes = await loadOpenDbIndexes().catch(() => ({ title: null } as any));
  const entry = indexes?.title?.[normalized];
  if (!entry) return [];
  const records = Array.isArray(entry) ? entry : [entry];
  return records.map((r: any) => ({
    id: null,
    title: r.title,
    release_date: r.year ? `${r.year}-01-01` : '',
    overview: 'Found in Open Database.',
    note: r.edition || '',
    _source: 'open-db-title-index',
    _score: 45,
  }));
}

async function lookupUpcItemDb(upc: string) {
  const data = await fetchJsonWithRetry(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`, 1, 700, 7000
  ).catch(() => null);
  const rawTitle = data?.items?.[0]?.title?.trim();
  if (!rawTitle) return null;
  const titleCandidates = buildTitleVariants(rawTitle);
  return { rawTitle, cleanTitle: titleCandidates[0] || rawTitle, titleCandidates };
}

function rankTmdbResults(results: any[], preferredTitle = '', preferredYear: number | null = null) {
  const unique: any[] = [];
  const seen = new Set<string>();
  for (const item of results || []) {
    const key = item.id
      ? `id:${item.id}`
      : `t:${normalizeTitle(item.title)}:${safeYear(item.release_date) || 'na'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique
    .map((item) => ({ ...item, _score: scoreMovieCandidate(item, preferredTitle, preferredYear), _source: 'tmdb' }))
    .sort((a, b) => b._score - a._score);
}

async function searchTmdbByTitleCandidates(titles: string[], preferredTitle = '', preferredYear: number | null = null) {
  const queries = [...new Set((titles || []).filter(Boolean))].slice(0, 3);
  if (queries.length === 0) return [];
  const results = await Promise.all(queries.map((t) => searchMovie(t).catch(() => [])));
  return rankTmdbResults(results.flat(), preferredTitle || queries[0], preferredYear);
}

export async function lookupByIdentifiedTitle(title: string, year: number | null): Promise<any[]> {
  return searchTmdbByTitleCandidates(buildTitleVariants(title), title, year);
}

function cacheSet(key: string, value: LookupResult) {
  cache.set(key, { ts: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

export async function lookupQuery(rawQuery: string): Promise<LookupResult> {
  const query = normalizeScanOrInput(rawQuery);
  if (!query) return { status: 'not_found', candidates: [], detectedEdition: '' };

  const cached = cache.get(query);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const isBarcode = /^\d{8,14}$/.test(query);
  let detectedEdition = '';
  let result: LookupResult;

  if (!isBarcode) {
    const [openDbTitleCandidates, tmdbResults] = await Promise.all([
      lookupOpenDbByTitle(query),
      searchMovie(query).catch(() => []),
    ]);
    const merged = [...rankTmdbResults(tmdbResults, query, null), ...openDbTitleCandidates];
    result = merged.length > 0
      ? { status: 'ok', candidates: merged.slice(0, 8), detectedEdition: '' }
      : {
          status: 'ok',
          detectedEdition: '',
          candidates: [{
            id: null, title: query, release_date: '',
            overview: 'Manual title entry. TMDB match unavailable.',
            note: '', _source: 'manual-title', _score: 1,
          }],
        };
    cacheSet(query, result);
    return result;
  }

  // Barcode path
  const [tmdbDirect, openDbRecord] = await Promise.all([
    (async () => {
      const upcs = buildUpcCandidates(query).slice(0, 2);
      const responses = await Promise.all(upcs.map((u) => findByUpc(u).catch(() => [])));
      return responses.flat();
    })(),
    lookupOpenDbByUpc(query),
  ]);

  let tmdbResults = tmdbDirect;
  let preferredTitle = '';
  let preferredYear: number | null = null;

  if (openDbRecord) {
    preferredTitle = (openDbRecord.title || '').trim();
    preferredYear = safeYear(openDbRecord.year);
    detectedEdition = openDbRecord.edition || openDbRecord.title || '';
    if (preferredTitle && tmdbResults.length === 0) {
      tmdbResults = await searchTmdbByTitleCandidates(buildTitleVariants(preferredTitle), preferredTitle, preferredYear);
    }
  }

  const ranked = tmdbResults[0]?._score !== undefined
    ? tmdbResults
    : rankTmdbResults(tmdbResults, preferredTitle, preferredYear);

  if (ranked.length > 0) {
    result = { status: 'ok', candidates: ranked.slice(0, 8), detectedEdition };
  } else if (openDbRecord) {
    result = {
      status: 'ok',
      detectedEdition,
      candidates: [{
        id: null,
        title: openDbRecord.title,
        release_date: openDbRecord.year ? `${openDbRecord.year}-01-01` : '',
        overview: 'Found in Open Database. TMDB details unavailable.',
        note: openDbRecord.edition || '',
        _source: openDbRecord.source,
        _score: 70,
      }],
    };
  } else {
    let upcFallback = null;
    for (const upc of buildUpcCandidates(query)) {
      upcFallback = await lookupUpcItemDb(upc);
      if (upcFallback) break;
    }
    if (upcFallback) {
      detectedEdition = upcFallback.rawTitle;
      const fallbackRanked = await searchTmdbByTitleCandidates(
        upcFallback.titleCandidates, upcFallback.cleanTitle, null
      );
      result = fallbackRanked.length > 0
        ? { status: 'ok', candidates: fallbackRanked.slice(0, 8), detectedEdition }
        : {
            status: 'ok',
            detectedEdition,
            candidates: [{
              id: null, title: upcFallback.cleanTitle, release_date: '',
              overview: 'Found by UPC lookup, but TMDB match is unavailable.',
              note: upcFallback.rawTitle, _source: 'upcitemdb', _score: 55,
            }],
          };
    } else {
      result = { status: 'not_found', candidates: [], detectedEdition: '' };
    }
  }

  cacheSet(query, result);
  return result;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/services` — Expected: all PASS. Note: the Open DB module cache (`openDbIndexes.loaded`) persists across tests in one file — the stubbed 404s make it `{upc:null,title:null}` which every test path tolerates.

- [x] **Step 5: Commit**

```bash
git add server/services/
git commit -m "BLU-ARCH-0002: server-side TMDB + lookup services (port of useLookup search flow)"
```

---

### Task 6: Movies CRUD resource routes with validation

**Files:**
- Modify: `app/routes/api.movies.ts`, `app/routes/api.movies.$pk.ts` (replace Task 1 stubs)
- Create: `server/services/movies-api.ts` (route logic, testable without HTTP)
- Test: `server/services/movies-api.test.ts`

**Interfaces:**
- Consumes: Task 2 CRUD; Task 7's `runEnrichment(pk)` — until Task 7 lands, `movies-api.ts` imports `runEnrichment` from `./enrich`, so this task also creates a placeholder `server/services/enrich.ts` exporting `export async function runEnrichment(_pk: number): Promise<void> {}` (replaced in Task 7).
- Produces:
  - `createMovie(db, input): { record } | { error, status }` — validates and inserts; assigns `id` (tmdb_id or `manual-<Date.now()>`), `added_at`, `status` (`pending_enrichment` if tmdb_id else `needs_tmdb_match`).
  - `patchMovie(db, pk, input)`, `removeMovie(db, pk)` — same result convention.
  - HTTP: `POST /api/movies` → 201 record; `PATCH /api/movies/:pk` → 200 record; `DELETE /api/movies/:pk` → 200 `{deleted: true}`; validation failures → 400 `{error}`; missing pk → 404; wrong method → 405.

- [x] **Step 1: Write failing tests**

`server/services/movies-api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/index';
import { getMovie, insertMovie } from '../db/movies';
import { createMovie, patchMovie, removeMovie } from './movies-api';

let db: ReturnType<typeof createDb>;
beforeEach(() => {
  db = createDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bluray-test-')), 't.db'));
});

describe('createMovie', () => {
  it('creates a tmdb-matched movie as pending_enrichment', () => {
    const res: any = createMovie(db, { tmdb_id: 1422, title: 'The Departed', poster_path: '/x.jpg', release_date: '2006-10-04', overview: 'Mole.', upc: '883929800815', note: '4K', match_source: 'tmdb', match_score: 147 });
    expect(res.record.status).toBe('pending_enrichment');
    expect(res.record.id).toBe(1422);
    expect(res.record.pk).toBeGreaterThan(0);
    expect(typeof res.record.added_at).toBe('string');
  });

  it('creates a manual movie as needs_tmdb_match with manual- id', () => {
    const res: any = createMovie(db, { title: 'Obscure Import' });
    expect(res.record.status).toBe('needs_tmdb_match');
    expect(String(res.record.id)).toMatch(/^manual-/);
  });

  it('rejects missing/oversized titles and unknown fields are ignored', () => {
    expect((createMovie(db, {}) as any).error).toMatch(/title/i);
    expect((createMovie(db, { title: 'x'.repeat(501) }) as any).error).toMatch(/title/i);
    const res: any = createMovie(db, { title: 'Ok', hacker_field: 'nope' });
    expect(getMovie(db, res.record.pk).hacker_field).toBeUndefined();
  });
});

describe('patchMovie', () => {
  it('updates whitelisted personal fields and manages loaned_at', () => {
    const pk = insertMovie(db, { id: 1, title: 'A', added_at: '2026-01-01T00:00:00.000Z' });
    let res: any = patchMovie(db, pk, { watch_status: 'watched', personal_rating: 8, note: 'Steelbook' });
    expect(res.record.watch_status).toBe('watched');
    res = patchMovie(db, pk, { loaned_to: 'Sam' });
    expect(res.record.loaned_to).toBe('Sam');
    expect(res.record.loaned_at).toBeTruthy();
    res = patchMovie(db, pk, { loaned_to: null });
    expect(res.record.loaned_to).toBeNull();
    expect(res.record.loaned_at).toBeNull();
  });

  it('rejects invalid values and non-whitelisted fields', () => {
    const pk = insertMovie(db, { id: 1, title: 'A', added_at: '2026-01-01T00:00:00.000Z' });
    expect((patchMovie(db, pk, { watch_status: 'maybe' }) as any).error).toBeTruthy();
    expect((patchMovie(db, pk, { personal_rating: 11 }) as any).error).toBeTruthy();
    expect((patchMovie(db, pk, { title: 'Renamed' }) as any).error).toBeTruthy();
    expect((patchMovie(db, 9999, { note: 'x' }) as any).status).toBe(404);
  });
});

describe('removeMovie', () => {
  it('deletes and 404s on repeat', () => {
    const pk = insertMovie(db, { id: 1, title: 'A', added_at: '2026-01-01T00:00:00.000Z' });
    expect((removeMovie(db, pk) as any).deleted).toBe(true);
    expect((removeMovie(db, pk) as any).status).toBe(404);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/services/movies-api.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

`server/services/enrich.ts` (placeholder, replaced in Task 7):

```ts
export async function runEnrichment(_pk: number): Promise<void> {}
```

`server/services/movies-api.ts`:

```ts
import type { Database } from 'better-sqlite3';
import { insertMovie, getMovie, updateMovie, deleteMovie, rowToApi } from '../db/movies';

const str = (v: any, max: number) => (typeof v === 'string' && v.length <= max ? v : undefined);

export function createMovie(db: Database, input: any) {
  const title = str(input?.title, 500)?.trim();
  if (!title) return { error: 'title is required (string, max 500 chars)', status: 400 };

  const tmdbId = Number.isInteger(input.tmdb_id) ? input.tmdb_id : null;
  const record = {
    id: tmdbId ?? `manual-${Date.now()}`,
    tmdb_id: tmdbId ?? undefined,
    title,
    poster_path: str(input.poster_path, 200),
    release_date: str(input.release_date, 10),
    overview: str(input.overview, 2000),
    upc: str(input.upc, 100),
    added_at: new Date().toISOString(),
    note: str(input.note, 200) ?? '',
    status: tmdbId ? 'pending_enrichment' : 'needs_tmdb_match',
    match_source: str(input.match_source, 50) ?? 'manual',
    match_score: Number.isInteger(input.match_score) ? input.match_score : undefined,
  };
  const pk = insertMovie(db, record);
  return { record: rowToApi(getMovie(db, pk)) };
}

export function patchMovie(db: Database, pk: number, input: any) {
  if (!getMovie(db, pk)) return { error: 'Not found', status: 404 };
  const fields: Record<string, any> = {};

  if ('note' in input) {
    const note = str(input.note, 200);
    if (note === undefined) return { error: 'note must be a string, max 200 chars', status: 400 };
    fields.note = note;
  }
  if ('watch_status' in input) {
    if (input.watch_status !== 'watched' && input.watch_status !== 'unwatched') {
      return { error: 'watch_status must be watched|unwatched', status: 400 };
    }
    fields.watch_status = input.watch_status;
  }
  if ('personal_rating' in input) {
    const r = input.personal_rating;
    if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 10)) {
      return { error: 'personal_rating must be 1-10 or null', status: 400 };
    }
    fields.personal_rating = r;
  }
  if ('loaned_to' in input) {
    const who = input.loaned_to === null ? null : str(input.loaned_to, 120)?.trim();
    if (who === undefined) return { error: 'loaned_to must be a string (max 120) or null', status: 400 };
    fields.loaned_to = who || null;
    fields.loaned_at = who ? new Date().toISOString() : null;
  }

  const allowed = new Set(['note', 'watch_status', 'personal_rating', 'loaned_to']);
  const rejected = Object.keys(input).filter((k) => !allowed.has(k));
  if (rejected.length > 0) return { error: `Fields not updatable: ${rejected.join(', ')}`, status: 400 };

  updateMovie(db, pk, fields);
  return { record: rowToApi(getMovie(db, pk)) };
}

export function removeMovie(db: Database, pk: number) {
  if (!getMovie(db, pk)) return { error: 'Not found', status: 404 };
  deleteMovie(db, pk);
  return { deleted: true };
}
```

`app/routes/api.movies.ts`:

```ts
import type { ActionFunctionArgs } from 'react-router';
import { getDb } from '../../server/db/index';
import { createMovie } from '../../server/services/movies-api';
import { runEnrichment } from '../../server/services/enrich';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const input = await request.json().catch(() => null);
  if (!input) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });

  const result: any = createMovie(getDb(), input);
  if (result.error) return Response.json({ error: result.error }, { status: result.status });

  if (result.record.status === 'pending_enrichment') {
    void runEnrichment(result.record.pk).catch((e) => console.error('enrichment failed', e));
  }
  return Response.json(result.record, { status: 201 });
}
```

`app/routes/api.movies.$pk.ts`:

```ts
import type { ActionFunctionArgs } from 'react-router';
import { getDb } from '../../server/db/index';
import { patchMovie, removeMovie } from '../../server/services/movies-api';

export async function action({ request, params }: ActionFunctionArgs) {
  const pk = Number(params.pk);
  if (!Number.isInteger(pk)) return Response.json({ error: 'Invalid pk' }, { status: 400 });
  const db = getDb();

  if (request.method === 'PATCH') {
    const input = await request.json().catch(() => null);
    if (!input) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    const result: any = patchMovie(db, pk, input);
    if (result.error) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result.record);
  }

  if (request.method === 'DELETE') {
    const result: any = removeMovie(db, pk);
    if (result.error) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result);
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/services` — Expected: all PASS. Then `npm run build` — Expected: clean build.

- [x] **Step 5: Commit**

```bash
git add server/services/ app/routes/api.movies.ts app/routes/api.movies.\$pk.ts
git commit -m "BLU-ARCH-0002: movies CRUD API with validated create/patch/delete"
```

---

### Task 7: Enrichment service (port of details_scraper.py) + retry route

**Files:**
- Modify: `server/services/enrich.ts` (replace placeholder), `app/routes/api.movies.$pk.enrich.ts` (replace stub)
- Test: `server/services/enrich.test.ts`

**Interfaces:**
- Consumes: Task 2 (`getDb`, `getMovie`, `updateMovie`, `rowToApi`), Task 5 (`getMovieDetails`).
- Produces:
  - `runEnrichment(pk: number): Promise<void>` — uses `getDb()`; resolves tmdb id from `tmdb_id` (or numeric `id`), fetches details, writes `runtime`, `production_countries` (ISO codes), `audio_tracks` (spoken language english names), `genres` (names), `tagline`, `overview` (keep existing if TMDB's is empty), `status='enriched'`, `enriched_at`. No tmdb id → `status='needs_tmdb_match'`. Fetch/parse failure → `status='enrich_failed'`. String/array shape-validation per TM-0001.
  - HTTP: `POST /api/movies/:pk/enrich` — runs enrichment synchronously, returns the updated record.

- [x] **Step 1: Write failing tests**

`server/services/enrich.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/index';
import { insertMovie, getMovie, rowToRecord } from '../db/movies';

// runEnrichment uses getDb(); point DATA_DIR at a temp dir per test run
let db: ReturnType<typeof createDb>;

const TMDB_DETAILS = {
  runtime: 151,
  production_countries: [{ iso_3166_1: 'HK' }, { iso_3166_1: 'US' }],
  spoken_languages: [{ english_name: 'English' }, { english_name: 'Cantonese' }],
  genres: [{ name: 'Drama' }, { name: 'Thriller' }, { name: 'Crime' }],
  tagline: 'Cops or criminals.',
  overview: 'Mole story.',
};

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluray-test-'));
  process.env.DATA_DIR = dir;
  process.env.TMDB_API_KEY = 'test-key';
  globalThis.__blurayDb = undefined;
  const { getDb } = await import('../db/index');
  db = getDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.__blurayDb = undefined;
});

describe('runEnrichment', () => {
  it('fills fields exactly like details_scraper.py did', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(TMDB_DETAILS))));
    const { runEnrichment } = await import('./enrich');
    const pk = insertMovie(db, { id: 1422, tmdb_id: 1422, title: 'The Departed', added_at: '2026-01-01T00:00:00.000Z', status: 'pending_enrichment' });
    await runEnrichment(pk);
    const rec = rowToRecord(getMovie(db, pk));
    expect(rec.runtime).toBe(151);
    expect(rec.production_countries).toEqual(['HK', 'US']);
    expect(rec.audio_tracks).toEqual(['English', 'Cantonese']);
    expect(rec.genres).toEqual(['Drama', 'Thriller', 'Crime']);
    expect(rec.tagline).toBe('Cops or criminals.');
    expect(rec.overview).toBe('Mole story.');
    expect(rec.status).toBe('enriched');
    expect(typeof rec.enriched_at).toBe('string');
  });

  it('marks movies without a tmdb id as needs_tmdb_match', async () => {
    const { runEnrichment } = await import('./enrich');
    const pk = insertMovie(db, { id: 'manual-1', title: 'X', added_at: '2026-01-01T00:00:00.000Z', status: 'pending_enrichment' });
    await runEnrichment(pk);
    expect(getMovie(db, pk).status).toBe('needs_tmdb_match');
  });

  it('marks fetch failures as enrich_failed without losing the movie', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const { runEnrichment } = await import('./enrich');
    const pk = insertMovie(db, { id: 1, tmdb_id: 1, title: 'X', added_at: '2026-01-01T00:00:00.000Z', status: 'pending_enrichment' });
    await runEnrichment(pk);
    expect(getMovie(db, pk).status).toBe('enrich_failed');
    expect(getMovie(db, pk).title).toBe('X');
  });

  it('shape-validates hostile TMDB responses (TM-0001)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      runtime: 'not-a-number',
      genres: [{ name: 'Ok' }, { name: 12345 }, 'garbage'],
      spoken_languages: 'nope',
      production_countries: [{ iso_3166_1: 'US' }],
      tagline: 'x'.repeat(9999),
      overview: null,
    }))));
    const { runEnrichment } = await import('./enrich');
    const pk = insertMovie(db, { id: 1, tmdb_id: 1, title: 'X', added_at: '2026-01-01T00:00:00.000Z', overview: 'keep me', status: 'pending_enrichment' });
    await runEnrichment(pk);
    const rec = rowToRecord(getMovie(db, pk));
    expect(rec.runtime).toBeUndefined();
    expect(rec.genres).toEqual(['Ok']);
    expect(rec.audio_tracks).toEqual([]);
    expect(rec.tagline.length).toBeLessThanOrEqual(500);
    expect(rec.overview).toBe('keep me');
    expect(rec.status).toBe('enriched');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/services/enrich.test.ts` — Expected: FAIL (placeholder does nothing).

- [x] **Step 3: Implement**

`server/services/enrich.ts` (full replacement):

```ts
import { getDb } from '../db/index';
import { getMovie, updateMovie } from '../db/movies';
import { getMovieDetails } from './tmdb';

const stringArray = (value: any, pick: (item: any) => any, max = 20): string[] =>
  (Array.isArray(value) ? value : [])
    .map(pick)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .slice(0, max);

const cappedString = (value: any, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

export async function runEnrichment(pk: number): Promise<void> {
  const db = getDb();
  const movie = getMovie(db, pk);
  if (!movie) return;

  const tmdbId = movie.tmdb_id ?? (/^\d+$/.test(movie.id) ? Number(movie.id) : null);
  if (!tmdbId) {
    updateMovie(db, pk, { status: 'needs_tmdb_match' });
    return;
  }

  let details: any;
  try {
    details = await getMovieDetails(tmdbId);
  } catch {
    details = null;
  }
  if (!details) {
    updateMovie(db, pk, { status: 'enrich_failed' });
    return;
  }

  updateMovie(db, pk, {
    runtime: Number.isInteger(details.runtime) ? details.runtime : null,
    production_countries: stringArray(details.production_countries, (c) => c?.iso_3166_1),
    audio_tracks: stringArray(details.spoken_languages, (l) => l?.english_name),
    genres: stringArray(details.genres, (g) => g?.name),
    tagline: cappedString(details.tagline, 500),
    overview: cappedString(details.overview, 2000) || movie.overview || '',
    status: 'enriched',
    enriched_at: new Date().toISOString(),
  });
}
```

`app/routes/api.movies.$pk.enrich.ts`:

```ts
import type { ActionFunctionArgs } from 'react-router';
import { getDb } from '../../server/db/index';
import { getMovie, rowToApi } from '../../server/db/movies';
import { runEnrichment } from '../../server/services/enrich';

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const pk = Number(params.pk);
  const db = getDb();
  if (!Number.isInteger(pk) || !getMovie(db, pk)) return Response.json({ error: 'Not found' }, { status: 404 });
  await runEnrichment(pk);
  return Response.json(rowToApi(getMovie(db, pk)));
}
```

Note for the Task 2 implementer dependency: `updateMovie` must accept `runtime: null` (it does — `runtime` is in `UPDATABLE_FIELDS`).

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/services` — Expected: all PASS (including Task 6's tests, still green with the real enrich module).

- [x] **Step 5: Commit**

```bash
git add server/services/enrich.ts server/services/enrich.test.ts app/routes/api.movies.\$pk.enrich.ts
git commit -m "BLU-ARCH-0002: server-side enrichment (details_scraper.py port) + retry endpoint"
```

---

### Task 8: Cover identification route with hard usage cap

**Files:**
- Modify: `app/routes/api.identify.ts` (replace stub)
- Create: `server/services/identify.ts`
- Test: `server/services/identify.test.ts`

**Interfaces:**
- Consumes: Task 5 (`lookupByIdentifiedTitle`), Task 2 (`getDb`, scan_usage table).
- Produces:
  - `getMonthlyUsage(db): { month, scans, cost }` — from scan_usage.
  - `identifyCover(db, image: string, mediaType: string): Promise<...>` — returns `{ error, status }` on cap/validation/API failure; `{ identified: null }` when Claude can't ID; `{ identified: {title, year, edition}, candidates, usage }` on success. Records a scan_usage row only on a successful API call.
  - HTTP: `POST /api/identify` with JSON `{ image: <base64>, media_type: 'image/jpeg'|'image/png'|'image/webp' }`.
- Constraints: base64 length cap 1,400,000 chars (~1 MB); monthly cap `SCAN_MONTHLY_CAP` (default 200) → 429; Anthropic errors mapped to the same friendly messages as today's `parseAnthropicError`.

- [x] **Step 1: Write failing tests**

`server/services/identify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/index';
import { identifyCover, getMonthlyUsage } from './identify';

let db: ReturnType<typeof createDb>;
const B64 = 'aGVsbG8='; // tiny valid base64

const anthropicOk = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: 'text', text }] }));

beforeEach(() => {
  db = createDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bluray-test-')), 't.db'));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.TMDB_API_KEY = 'test-key';
  process.env.SCAN_MONTHLY_CAP = '200';
});

afterEach(() => vi.unstubAllGlobals());

describe('identifyCover', () => {
  it('identifies, records usage, and returns TMDB candidates', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('anthropic.com')) return anthropicOk('{"title":"The Departed","year":2006,"edition":"4K Ultra HD"}');
      if (String(url).includes('/search/movie')) return new Response(JSON.stringify({ results: [{ id: 1422, title: 'The Departed', release_date: '2006-10-04' }] }));
      return new Response('nf', { status: 404 });
    }));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.identified.title).toBe('The Departed');
    expect(res.candidates[0].id).toBe(1422);
    expect(getMonthlyUsage(db).scans).toBe(1);
  });

  it('strips code fences from the model reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('anthropic.com')
        ? anthropicOk('```json\n{"title":"In Bruges","year":2008}\n```')
        : new Response(JSON.stringify({ results: [] }))
    ));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.identified.title).toBe('In Bruges');
  });

  it('enforces the hard monthly cap with 429', async () => {
    process.env.SCAN_MONTHLY_CAP = '2';
    const month = new Date().toISOString().slice(0, 7);
    const stmt = db.prepare('INSERT INTO scan_usage (month, created_at) VALUES (?, ?)');
    stmt.run(month, new Date().toISOString());
    stmt.run(month, new Date().toISOString());
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.status).toBe(429);
    expect(res.error).toMatch(/cap/i);
  });

  it('rejects oversized and wrong-type images with 400', async () => {
    expect(((await identifyCover(db, 'x'.repeat(1_400_001), 'image/jpeg')) as any).status).toBe(400);
    expect(((await identifyCover(db, B64, 'image/gif')) as any).status).toBe(400);
  });

  it('maps Anthropic API errors to friendly messages without recording usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'bad key' } }), { status: 401 })
    ));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.error).toMatch(/Anthropic API key/);
    expect(getMonthlyUsage(db).scans).toBe(0);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/services/identify.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

`server/services/identify.ts`:

```ts
import type { Database } from 'better-sqlite3';
import { lookupByIdentifiedTitle } from './lookup';

const COST_PER_SCAN = 0.001;
const MAX_B64_LENGTH = 1_400_000; // ~1 MB decoded
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PROMPT =
  'This is a photo of a Blu-ray or 4K disc cover. Identify the movie.\n' +
  'Respond with a raw JSON object only — no markdown, no code fences, no extra text.\n' +
  'Example: {"title":"The Matrix","year":1999,"edition":"4K Ultra HD"}\n' +
  'If you cannot identify a title, respond: {"title":null}';

export function getMonthlyUsage(db: Database) {
  const month = new Date().toISOString().slice(0, 7);
  const row = db.prepare(
    'SELECT COUNT(*) AS scans, COALESCE(SUM(cost), 0) AS cost FROM scan_usage WHERE month = ?'
  ).get(month) as any;
  return { month, scans: row.scans, cost: Math.round(row.cost * 10000) / 10000 };
}

async function anthropicErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({} as any));
  const type = body?.error?.type || '';
  const msg = body?.error?.message || '';
  if (type === 'authentication_error') return 'Invalid Anthropic API key — check the server env.';
  if (type === 'permission_error' || msg.toLowerCase().includes('credit')) {
    return 'Anthropic credits exhausted — add credits at console.anthropic.com/settings/billing';
  }
  if (type === 'rate_limit_error' || response.status === 429) return 'Rate limited — wait a moment and try again.';
  if (type === 'overloaded_error' || response.status === 529) return 'Anthropic is overloaded — try again shortly.';
  return msg || `API error ${response.status}`;
}

export async function identifyCover(db: Database, image: string, mediaType: string) {
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'Cover identification is not configured on the server.', status: 503 };
  if (typeof image !== 'string' || image.length === 0 || image.length > MAX_B64_LENGTH) {
    return { error: 'image must be base64, max ~1MB', status: 400 };
  }
  if (!MEDIA_TYPES.has(mediaType)) return { error: 'media_type must be image/jpeg, image/png, or image/webp', status: 400 };

  const cap = Number(process.env.SCAN_MONTHLY_CAP || 200);
  const usage = getMonthlyUsage(db);
  if (usage.scans >= cap) {
    return { error: `Monthly scan cap reached (${cap}). Raise SCAN_MONTHLY_CAP if intentional.`, status: 429 };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 128,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });

  if (!response.ok) return { error: await anthropicErrorMessage(response), status: 502 };

  const data: any = await response.json().catch(() => null);
  const raw = data?.content?.[0]?.text?.trim() || '';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { error: `Unexpected model response: ${raw.slice(0, 80)}`, status: 502 };
  }

  db.prepare('INSERT INTO scan_usage (month, created_at, cost) VALUES (?, ?, ?)')
    .run(new Date().toISOString().slice(0, 7), new Date().toISOString(), COST_PER_SCAN);

  if (!parsed?.title || typeof parsed.title !== 'string') {
    return { identified: null, usage: getMonthlyUsage(db) };
  }

  const title = parsed.title.trim().slice(0, 300);
  const year = Number.isInteger(Number(parsed.year)) && parsed.year ? Number(parsed.year) : null;
  const edition = typeof parsed.edition === 'string' ? parsed.edition.trim().slice(0, 200) : '';

  const candidates = await lookupByIdentifiedTitle(title, year);
  return { identified: { title, year, edition }, candidates: candidates.slice(0, 8), usage: getMonthlyUsage(db) };
}
```

`app/routes/api.identify.ts`:

```ts
import type { ActionFunctionArgs } from 'react-router';
import { getDb } from '../../server/db/index';
import { identifyCover } from '../../server/services/identify';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  const result: any = await identifyCover(getDb(), body.image, body.media_type);
  if (result.error) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result);
}
```

Also implement `app/routes/api.lookup.ts` now (replaces stub — it's three lines and belongs with this API surface):

```ts
import type { LoaderFunctionArgs } from 'react-router';
import { lookupQuery } from '../../server/services/lookup';

export async function loader({ request }: LoaderFunctionArgs) {
  const q = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (!q || q.length > 200) return Response.json({ error: 'q is required, max 200 chars' }, { status: 400 });
  return Response.json(await lookupQuery(q));
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server` — Expected: all PASS. Then `npm run build` — Expected: clean.

- [x] **Step 5: Commit**

```bash
git add server/services/identify.ts server/services/identify.test.ts app/routes/api.identify.ts app/routes/api.lookup.ts
git commit -m "BLU-ARCH-0002: cover-ID endpoint with hard monthly cap + lookup endpoint"
```

---

### Task 9: UI port — components, client lookup hook, home route

**Files:**
- Create (copy verbatim): `app/components/MovieCard.jsx`, `app/components/MovieGrid.jsx` from `web/src/components/`
- Create (copy + edits below): `app/components/Scanner.jsx`, `app/components/MovieDetail.jsx`
- Create: `app/hooks/useServerLookup.js`
- Modify: `app/routes/home.jsx` (replace placeholder)

**Interfaces:**
- Consumes: `/api/lookup`, `/api/identify`, `/api/movies`, `/api/movies/:pk`, `/api/movies/:pk/enrich`; Task 4 utils.
- Produces: the working app UI. `useServerLookup()` returns the same surface today's `useLookup(keys)` returned minus `coverUsage` (now loader data): `{ loading, statusMsg, movieData, searchCandidates, scannedCode, userNote, setScannedCode, setUserNote, handleScan, search, identifyFromCover, selectMovieCandidate, reset }`.

- [x] **Step 1: Copy unchanged components**

```bash
mkdir -p app/components app/hooks
cp web/src/components/MovieCard.jsx web/src/components/MovieGrid.jsx app/components/
```

- [x] **Step 2: Copy Scanner with the settings-reference edit**

`cp web/src/components/Scanner.jsx app/components/Scanner.jsx`, then replace the locked-state block (the `<div className="text-center space-y-3 py-4">` under `{tab === 'cover' && (` / `) : (`) with:

```jsx
              <div className="text-center space-y-3 py-4">
                <p className="text-4xl">🔒</p>
                <p className="text-gray-300 font-semibold">Cover identification not configured</p>
                <p className="text-sm text-gray-500">Set ANTHROPIC_API_KEY in the server environment to enable it.</p>
              </div>
```

(The `onClose`/"Go to Settings" button is removed — there is no settings screen anymore.)

- [x] **Step 3: Write MovieDetail with personal-field controls**

Copy `web/src/components/MovieDetail.jsx` to `app/components/MovieDetail.jsx`, change the signature to `function MovieDetail({ movie, onClose, onDelete, onUpdate, onRetryEnrich })`, delete the `canDelete = false` prop and its conditional (delete button always renders now), and insert this block between the tech-specs grid (`</div>` closing `grid grid-cols-2...`) and the delete button:

```jsx
                    {/* Personal tracking */}
                    <div className="border-t border-gray-800 mt-4 pt-4 space-y-3 text-sm">
                        <div className="flex items-center justify-between">
                            <h4 className="text-gray-500 uppercase text-xs font-bold">Watched</h4>
                            <button
                                onClick={() => onUpdate(movie, { watch_status: movie.watch_status === 'watched' ? 'unwatched' : 'watched' })}
                                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${movie.watch_status === 'watched' ? 'bg-green-700 border-green-700 text-white' : 'border-gray-600 text-gray-400'}`}
                            >
                                {movie.watch_status === 'watched' ? '✓ Watched' : 'Not watched'}
                            </button>
                        </div>
                        <div className="flex items-center justify-between">
                            <h4 className="text-gray-500 uppercase text-xs font-bold">My rating</h4>
                            <select
                                value={movie.personal_rating ?? ''}
                                onChange={(e) => onUpdate(movie, { personal_rating: e.target.value ? Number(e.target.value) : null })}
                                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
                            >
                                <option value="">—</option>
                                {[1,2,3,4,5,6,7,8,9,10].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <h4 className="text-gray-500 uppercase text-xs font-bold">Loaned to</h4>
                            <form
                                className="flex gap-2"
                                onSubmit={(e) => { e.preventDefault(); onUpdate(movie, { loaned_to: e.target.elements.who.value.trim() || null }); }}
                            >
                                <input name="who" defaultValue={movie.loaned_to || ''} placeholder="nobody"
                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 w-32 text-gray-200" />
                                <button type="submit" className="text-blue-400 text-xs underline">save</button>
                            </form>
                        </div>
                        {movie.loaned_to && movie.loaned_at && (
                            <p className="text-xs text-gray-500 text-right">since {new Date(movie.loaned_at).toLocaleDateString()}</p>
                        )}
                        {movie.status && movie.status !== 'enriched' && (
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-yellow-500">
                                    {movie.status === 'enrich_failed' ? 'Enrichment failed' : movie.status === 'pending_enrichment' ? 'Enrichment pending…' : 'No TMDB match'}
                                </span>
                                {(movie.status === 'enrich_failed' || movie.status === 'pending_enrichment') && (
                                    <button onClick={() => onRetryEnrich(movie)} className="text-blue-400 text-xs underline">Retry enrichment</button>
                                )}
                            </div>
                        )}
                    </div>
```

- [x] **Step 4: Write the client lookup hook**

`app/hooks/useServerLookup.js` (the state-machine half of old `useLookup`; all network orchestration now behind `/api/*`):

```js
import { useState } from 'react';
import { normalizeScanOrInput } from '../lib/movies';

const compressImageToBase64 = (file, maxPx = 600) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

export function useServerLookup() {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [movieData, setMovieData] = useState(null);
  const [searchCandidates, setSearchCandidates] = useState([]);
  const [scannedCode, setScannedCode] = useState('');
  const [userNote, setUserNote] = useState('');

  const reset = () => {
    setMovieData(null);
    setSearchCandidates([]);
    setScannedCode('');
    setUserNote('');
    setStatusMsg('');
    setLoading(false);
  };

  const selectMovieCandidate = (candidate, detectedEdition = '') => {
    if (!candidate) return;
    const merged = { ...candidate, note: candidate.note || detectedEdition || '' };
    setMovieData(merged);
    setUserNote(merged.note || '');
    setStatusMsg('Movie selected.');
  };

  const chooseCandidates = (candidates, detectedEdition = '') => {
    if (!candidates || candidates.length === 0) {
      setMovieData(null);
      setSearchCandidates([]);
      return;
    }
    if (candidates.length === 1) {
      setSearchCandidates(candidates);
      selectMovieCandidate(candidates[0], detectedEdition);
      return;
    }
    const [top, second] = candidates;
    setSearchCandidates(candidates.slice(0, 8));
    if (top._score >= 120 && (!second || top._score - second._score >= 25)) {
      selectMovieCandidate(top, detectedEdition);
    } else {
      setMovieData(null);
      setUserNote(detectedEdition || '');
      setStatusMsg('Multiple matches found. Choose the correct movie.');
    }
  };

  const search = async (query) => {
    const normalized = normalizeScanOrInput(query);
    if (!normalized) {
      setStatusMsg('Enter a title or UPC.');
      return;
    }
    setLoading(true);
    setStatusMsg('Searching...');
    setMovieData(null);
    setSearchCandidates([]);
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(normalized)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Lookup failed (${res.status})`);
      if (data.status === 'not_found') {
        setStatusMsg('Barcode not found. Try title search or manual entry.');
      } else {
        setStatusMsg('Matches found.');
        chooseCandidates(data.candidates, data.detectedEdition);
      }
    } catch (e) {
      setStatusMsg(`Lookup failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const identifyFromCover = async (imageFile) => {
    setLoading(true);
    setStatusMsg('Identifying cover...');
    setMovieData(null);
    setSearchCandidates([]);
    try {
      const b64 = await compressImageToBase64(imageFile);
      const res = await fetch('/api/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, media_type: 'image/jpeg' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Identify failed (${res.status})`);
      if (!data.identified) {
        setStatusMsg("Couldn't identify the cover. Try a clearer photo or type the title.");
        return;
      }
      const { title, year, edition } = data.identified;
      setStatusMsg(`Identified: "${title}". Searching...`);
      setScannedCode(title);
      if (edition) setUserNote(edition);
      if (data.candidates.length > 0) {
        chooseCandidates(data.candidates, edition);
      } else {
        chooseCandidates([{
          id: null, title, release_date: year ? `${year}-01-01` : '',
          overview: 'Identified from cover photo. No TMDB match found.',
          note: edition, _source: 'cover-photo', _score: 60,
        }], edition);
      }
    } catch (e) {
      setStatusMsg(`Cover ID failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = (code) => {
    const normalized = normalizeScanOrInput(code);
    setScannedCode(normalized);
    if (normalized) search(normalized);
  };

  return {
    loading, statusMsg, movieData, searchCandidates, scannedCode, userNote,
    setScannedCode, setUserNote, handleScan, search, identifyFromCover,
    selectMovieCandidate, reset,
  };
}
```

- [x] **Step 5: Write the home route**

`app/routes/home.jsx` — a port of `web/src/App.jsx` with the keys/gist/settings/GitHub machinery deleted, loader data replacing `loadMovies`, and plain-fetch mutations + `useRevalidator` replacing the GitHubClient (mutations complete in single-digit milliseconds on LAN, so the old optimistic-update complexity is dropped):

```jsx
import { useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';
import Scanner from '../components/Scanner';
import MovieGrid from '../components/MovieGrid';
import MovieDetail from '../components/MovieDetail';
import { useServerLookup } from '../hooks/useServerLookup';
import { getDb } from '../../server/db/index';
import { listMovies, searchMovies, rowToApi, getMeta } from '../../server/db/movies';
import { getMonthlyUsage } from '../../server/services/identify';
import { startScheduler } from '../../server/scheduler';

export function loader({ request }) {
  startScheduler();
  const db = getDb();
  const q = new URL(request.url).searchParams.get('q')?.trim() || '';
  const rows = q ? searchMovies(db, q) : listMovies(db);
  return {
    movies: rows.map(rowToApi),
    q,
    config: {
      canUseCover: Boolean(process.env.ANTHROPIC_API_KEY),
      coverUsage: getMonthlyUsage(db),
      lastBackupAt: getMeta(db, 'last_backup_at'),
      lastBackupOk: getMeta(db, 'last_backup_ok') !== 'false',
    },
  };
}

async function apiFetch(url, options) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function Home() {
  const { movies, q, config } = useLoaderData();
  const revalidator = useRevalidator();

  const [view, setView] = useState('home');
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [searchTerm, setSearchTerm] = useState(q);
  const [activeGenre, setActiveGenre] = useState(null);

  const {
    loading, statusMsg, movieData, searchCandidates, scannedCode, userNote,
    setScannedCode, setUserNote, handleScan, search, identifyFromCover,
    selectMovieCandidate, reset: resetLookup,
  } = useServerLookup();

  const handleSaveMovie = async () => {
    if (!movieData) return;
    const hasTmdbId = typeof movieData.id === 'number';
    try {
      await apiFetch('/api/movies', {
        method: 'POST',
        body: JSON.stringify({
          tmdb_id: hasTmdbId ? movieData.id : null,
          title: movieData.title,
          poster_path: movieData.poster_path || undefined,
          release_date: movieData.release_date || undefined,
          overview: movieData.overview || undefined,
          upc: scannedCode || undefined,
          note: userNote,
          match_source: movieData._source || 'manual',
          match_score: movieData._score ?? undefined,
        }),
      });
      setView('home');
      resetLookup();
      revalidator.revalidate();
      // Enrichment lands seconds later; refresh once more to pick it up.
      setTimeout(() => revalidator.revalidate(), 4000);
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    }
  };

  const handleDeleteMovie = async (movie) => {
    if (!window.confirm(`Delete "${movie.title}" from your collection?`)) return;
    setSelectedMovie(null);
    try {
      await apiFetch(`/api/movies/${movie.pk}`, { method: 'DELETE' });
      revalidator.revalidate();
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
    }
  };

  const handleUpdateMovie = async (movie, fields) => {
    try {
      const updated = await apiFetch(`/api/movies/${movie.pk}`, { method: 'PATCH', body: JSON.stringify(fields) });
      setSelectedMovie(updated);
      revalidator.revalidate();
    } catch (e) {
      alert(`Failed to update: ${e.message}`);
    }
  };

  const handleRetryEnrich = async (movie) => {
    try {
      const updated = await apiFetch(`/api/movies/${movie.pk}/enrich`, { method: 'POST' });
      setSelectedMovie(updated);
      revalidator.revalidate();
    } catch (e) {
      alert(`Failed to enrich: ${e.message}`);
    }
  };

  const handleBackToLibrary = () => {
    setView('home');
    resetLookup();
  };

  if (view === 'scan') {
    return (
      <Scanner
        onScan={(code) => { setView('add'); handleScan(code); }}
        onCoverPhoto={(file) => { setView('add'); identifyFromCover(file); }}
        canUseCover={config.canUseCover}
        coverUsage={config.coverUsage}
        onClose={() => setView('home')}
      />
    );
  }

  if (view === 'add') {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          <button onClick={handleBackToLibrary} className="mb-6 text-gray-400 flex items-center gap-2 text-lg">
            <span className="text-2xl">&larr;</span> Back to Library
          </button>
          <h2 className="text-3xl font-bold mb-6">Add Movie</h2>

          <div className="flex gap-2 mb-8">
            <input
              className="flex-1 bg-gray-800 p-4 rounded-xl text-lg outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search Title or UPC..."
              value={scannedCode}
              onChange={(e) => setScannedCode(e.target.value)}
            />
            <button onClick={() => search(scannedCode)} className="bg-blue-600 px-6 rounded-xl font-bold">Find</button>
          </div>

          {(loading || statusMsg) && (
            <div className={`text-center mb-6 p-5 rounded-2xl border ${loading ? 'bg-gray-800 border-blue-500/30' : 'bg-gray-800/50 border-gray-700'}`}>
              {loading && <div className="animate-spin text-4xl mb-3">💿</div>}
              <p className={`font-mono text-sm ${loading ? 'text-blue-400' : 'text-gray-400'}`}>{statusMsg}</p>
            </div>
          )}

          {searchCandidates.length > 1 && !movieData && (
            <div className="bg-gray-800/70 border border-gray-700 rounded-2xl p-4 mb-6">
              <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-3">Select the correct match</h3>
              <div className="space-y-2">
                {searchCandidates.map((candidate) => (
                  <button
                    key={`${candidate.id ?? candidate.title}-${candidate.release_date ?? ''}`}
                    onClick={() => selectMovieCandidate(candidate, userNote)}
                    className="w-full text-left p-3 rounded-lg bg-gray-900/60 hover:bg-gray-900 border border-gray-700 hover:border-blue-500 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{candidate.title}</p>
                        <p className="text-xs text-gray-400">{candidate.release_date?.split('-')[0] || 'Unknown year'} • score {candidate._score ?? 0}</p>
                      </div>
                      <span className="text-[10px] uppercase text-gray-500">{candidate._source || 'match'}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {movieData && !loading && (
            <div className="bg-gray-800 p-6 rounded-2xl shadow-2xl animate-fade-in">
              <div className="flex flex-col md:flex-row gap-6">
                {movieData.poster_path && (
                  <img src={`https://image.tmdb.org/t/p/w342${movieData.poster_path}`} alt="Poster" className="w-40 rounded-xl shadow-lg mx-auto md:mx-0" />
                )}
                <div className="flex-1 space-y-4">
                  <div>
                    <h3 className="text-2xl font-bold leading-tight">{movieData.title}</h3>
                    <p className="text-gray-400">{movieData.release_date?.split('-')[0] || 'Unknown year'}</p>
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Edition / Notes</label>
                    <input
                      value={userNote}
                      onChange={(e) => setUserNote(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 p-3 rounded-lg text-sm text-blue-300 focus:border-blue-500 outline-none"
                      placeholder="e.g. Steelbook, Criterion, Digital..."
                    />
                  </div>

                  <p className="text-sm text-gray-300 leading-relaxed">{movieData.overview || 'No summary available.'}</p>

                  <button
                    onClick={handleSaveMovie}
                    className="w-full bg-green-600 py-4 rounded-xl font-bold text-lg shadow-lg shadow-green-900/30 hover:scale-[1.02] transition-transform"
                  >
                    Add to Collection
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const allGenres = [...new Set(movies.flatMap((m) => m.genres || []))].sort();

  const filteredMovies = movies.filter((m) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      m.title.toLowerCase().includes(term) ||
      (m.note || '').toLowerCase().includes(term) ||
      (m.overview || '').toLowerCase().includes(term);
    const matchesGenre = !activeGenre || (m.genres || []).includes(activeGenre);
    return matchesSearch && matchesGenre;
  });

  const backupLabel = () => {
    if (!config.lastBackupAt) return 'Backup: never run';
    const days = Math.floor((Date.now() - Date.parse(config.lastBackupAt)) / 86400000);
    const when = days === 0 ? 'today' : `${days}d ago`;
    return config.lastBackupOk ? `Backup: ✓ ${when}` : `Backup: ⚠ failed (last success ${when})`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-safe">
      <header className="sticky top-0 z-20 bg-gray-900/90 backdrop-blur-md border-b border-gray-800 p-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              My Collection
            </h1>
            <div className="flex gap-4 md:hidden">
              <button onClick={() => setView('scan')} className="text-2xl">📷</button>
            </div>
          </div>

          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              placeholder="Filter movies..."
              className="w-full bg-gray-800 text-white pl-10 pr-4 py-2 rounded-full border border-gray-700 focus:border-blue-500 outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="absolute left-3 top-2.5 text-gray-500">🔍</span>
          </div>

          <div className="hidden md:flex gap-4">
            <button
              onClick={() => setView('scan')}
              className="bg-blue-600 px-4 py-2 rounded-full font-bold hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
            >
              + Add Movie
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto mt-4">
        {allGenres.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            <button
              onClick={() => setActiveGenre(null)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${!activeGenre ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-600 text-gray-400 hover:text-white hover:border-gray-400'}`}
            >
              All
            </button>
            {allGenres.map((g) => (
              <button
                key={g}
                onClick={() => setActiveGenre(activeGenre === g ? null : g)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${activeGenre === g ? 'bg-purple-700 border-purple-700 text-white' : 'border-gray-600 text-gray-400 hover:text-white hover:border-gray-400'}`}
              >
                {g}
              </button>
            ))}
          </div>
        )}
        <MovieGrid movies={filteredMovies} loading={false} onMovieClick={setSelectedMovie} />
      </main>

      <footer className="text-center text-xs text-gray-600 py-4">{backupLabel()}</footer>

      <button
        onClick={() => setView('scan')}
        className="md:hidden fixed bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full shadow-2xl shadow-blue-600/40 flex items-center justify-center text-2xl z-40 active:scale-90 transition-transform"
      >
        📷
      </button>

      {selectedMovie && (
        <MovieDetail
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          onDelete={handleDeleteMovie}
          onUpdate={handleUpdateMovie}
          onRetryEnrich={handleRetryEnrich}
        />
      )}
    </div>
  );
}
```

Note: `startScheduler` doesn't exist until Task 10. For this task, create `server/scheduler.ts` as a placeholder: `export function startScheduler(): void {}`.

- [x] **Step 6: Verify manually (UI smoke test)**

Run: `TMDB_API_KEY=<real key> npm run dev`, then in the browser at `http://localhost:3000`:
1. Empty library renders ("Your collection is empty").
2. Run `npm run import -- ./movies.json` (separate terminal, same `DATA_DIR`), reload — 41 movies render, genre chips appear, text filter works.
3. Add flow: + Add Movie → manual entry "In Bruges" → candidates appear → select → Add to Collection → appears in grid; within ~5s reload shows genres/runtime (enrichment ran).
4. Detail: open a movie → toggle Watched, set rating, set Loaned to → reload, values persist.
5. Delete the test movie added in step 3.

Expected: all five pass. `npm test` still green; `npm run build` clean.

- [x] **Step 7: Commit**

```bash
git add app/ server/scheduler.ts
git commit -m "BLU-ARCH-0002: UI port — home route, server-lookup hook, personal tracking controls"
```

---

### Task 10: Backup service + scheduler + footer already wired

**Files:**
- Create: `server/services/backup.ts`
- Modify: `server/scheduler.ts` (replace placeholder)
- Test: `server/services/backup.test.ts`

**Interfaces:**
- Consumes: Task 3 (`exportMoviesJson`), Task 2 (`getMeta`/`setMeta`).
- Produces:
  - `runBackup(db): Promise<{ ok: boolean, pushed: boolean, error?: string }>` — writes `$DATA_DIR/exports/movies.json` always; pushes to GitHub iff `GITHUB_TOKEN` + `GITHUB_REPO` set; on success sets meta `last_backup_at` (ISO now) and `last_backup_ok='true'`; on push failure sets `last_backup_ok='false'` (keeps old `last_backup_at`).
  - `startScheduler(): void` — `globalThis.__blurayScheduler` guard; first run 30s after boot, then hourly check; runs backup when `last_backup_at` missing or >24h old.
- Constraints: GitHub commit message `Nightly backup of movies.json [skip ci]`; non-force (contents API PUT with current sha); token never appears in errors or logs.

- [x] **Step 1: Write failing tests**

`server/services/backup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/index';
import { insertMovie, getMeta } from '../db/movies';
import { runBackup } from './backup';

let db: ReturnType<typeof createDb>;
let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluray-test-'));
  process.env.DATA_DIR = dataDir;
  db = createDb(path.join(dataDir, 'bluray.db'));
  insertMovie(db, { id: 1422, title: 'The Departed', added_at: '2026-01-01T00:00:00.000Z' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPO;
});

describe('runBackup', () => {
  it('writes the export file and records success even without a GitHub token', async () => {
    const result = await runBackup(db);
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(false);
    const exported = JSON.parse(fs.readFileSync(path.join(dataDir, 'exports', 'movies.json'), 'utf8'));
    expect(exported.movies[0].title).toBe('The Departed');
    expect(getMeta(db, 'last_backup_at')).toBeTruthy();
    expect(getMeta(db, 'last_backup_ok')).toBe('true');
  });

  it('pushes via the GitHub contents API with existing sha and [skip ci]', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_REPO = 'Solfood/bluray';
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: any = {}) => {
      calls.push({ url: String(url), opts });
      if (!opts.method) return new Response(JSON.stringify({ sha: 'abc123' }));
      return new Response(JSON.stringify({ commit: { sha: 'def' } }));
    }));
    const result = await runBackup(db);
    expect(result.pushed).toBe(true);
    const put = calls.find((c) => c.opts.method === 'PUT');
    expect(put.url).toBe('https://api.github.com/repos/Solfood/bluray/contents/movies.json');
    const body = JSON.parse(put.opts.body);
    expect(body.sha).toBe('abc123');
    expect(body.message).toContain('[skip ci]');
    expect(Buffer.from(body.content, 'base64').toString()).toContain('The Departed');
  });

  it('marks failure without leaking the token', async () => {
    process.env.GITHUB_TOKEN = 'sekrit-token';
    process.env.GITHUB_REPO = 'Solfood/bluray';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const result = await runBackup(db);
    expect(result.ok).toBe(false);
    expect(getMeta(db, 'last_backup_ok')).toBe('false');
    expect(result.error).not.toContain('sekrit-token');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/services/backup.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

`server/services/backup.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { exportMoviesJson } from '../db/transfer';
import { setMeta } from '../db/movies';

async function pushToGitHub(json: string): Promise<void> {
  const repo = process.env.GITHUB_REPO!;
  const url = `https://api.github.com/repos/${repo}/contents/movies.json`;
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  const currentRes = await fetch(url, { headers });
  const current: any = currentRes.ok ? await currentRes.json() : null;

  const putRes = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: 'Nightly backup of movies.json [skip ci]',
      content: Buffer.from(json).toString('base64'),
      ...(current?.sha ? { sha: current.sha } : {}),
    }),
  });
  if (!putRes.ok) throw new Error(`GitHub push failed with status ${putRes.status}`);
}

export async function runBackup(db: Database): Promise<{ ok: boolean; pushed: boolean; error?: string }> {
  const json = exportMoviesJson(db);
  const exportsDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.writeFileSync(path.join(exportsDir, 'movies.json'), json);

  const canPush = Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
  if (canPush) {
    try {
      await pushToGitHub(json);
    } catch (e: any) {
      setMeta(db, 'last_backup_ok', 'false');
      // Message is constructed above without headers/token; safe to surface.
      return { ok: false, pushed: false, error: e.message };
    }
  }

  setMeta(db, 'last_backup_at', new Date().toISOString());
  setMeta(db, 'last_backup_ok', 'true');
  return { ok: true, pushed: canPush };
}
```

`server/scheduler.ts` (full replacement):

```ts
import { getDb } from './db/index';
import { getMeta } from './db/movies';
import { runBackup } from './services/backup';

const DAY_MS = 24 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __blurayScheduler: boolean | undefined;
}

export function startScheduler(): void {
  if (globalThis.__blurayScheduler) return;
  globalThis.__blurayScheduler = true;

  const tick = async () => {
    try {
      const db = getDb();
      const last = getMeta(db, 'last_backup_at');
      if (!last || Date.now() - Date.parse(last) > DAY_MS) {
        const result = await runBackup(db);
        if (!result.ok) console.error('[backup]', result.error);
        else console.log(`[backup] exported${result.pushed ? ' and pushed' : ''}`);
      }
    } catch (e) {
      console.error('[backup] tick failed', e);
    }
  };

  setTimeout(tick, 30_000);
  setInterval(tick, 60 * 60 * 1000);
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server` — Expected: all PASS. `npm run build` — Expected: clean.

- [x] **Step 5: Commit**

```bash
git add server/services/backup.ts server/services/backup.test.ts server/scheduler.ts
git commit -m "BLU-ARCH-0002: nightly movies.json export + GitHub backup push with scheduler"
```

---

### Task 11: Docker packaging + deployment docs

**Files:**
- Create: `Dockerfile`, `compose.yaml`, `.env.example`
- Modify: `README.md` (if present at root — otherwise create) with a Deploy section

**Interfaces:**
- Consumes: everything prior.
- Produces: `docker compose up -d` serving the app on port 3000 with `/data` persisted to `./data`.

- [x] **Step 1: Write Docker files**

`Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
RUN mkdir -p /data && chown app:app /data
USER app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["./node_modules/.bin/react-router-serve", "./build/server/index.js"]
```

`compose.yaml`:

```yaml
services:
  bluray:
    build: .
    # TM-0001: keep this LAN-only. If the host has multiple interfaces,
    # bind explicitly to the LAN address, e.g. "192.168.1.50:3000:3000".
    # Never port-forward this service on the router.
    ports:
      - "3000:3000"
    env_file: .env
    volumes:
      - ./data:/data
    restart: unless-stopped
```

`.env.example`:

```bash
# TMDB API key (required for lookup + enrichment)
TMDB_API_KEY=

# Anthropic API key (optional — enables cover photo identification)
ANTHROPIC_API_KEY=

# Hard monthly cap on cover scans (default 200) — TM-0001 cost bound
SCAN_MONTHLY_CAP=200

# GitHub backup push (optional). Use a FINE-GRAINED PAT scoped to ONLY this
# repo with ONLY contents:read-write, with an expiry — TM-0001.
GITHUB_TOKEN=
GITHUB_REPO=Solfood/bluray
```

- [x] **Step 2: Add a Deploy section to README.md**

```markdown
## Deploy (bluray.local)

```bash
cp .env.example .env        # fill in keys; .env is gitignored
docker compose up -d --build
# one-time data import (runs inside the container's /data volume):
docker compose exec bluray sh -c "cd /app && DATA_DIR=/data node_modules/.bin/tsx server/db/import-cli.ts /app/movies.json"
```
```

Note: `tsx` is a devDependency and gets pruned from the production image. Either run the import from the host (`DATA_DIR=./data npm run import -- ./movies.json` before first `docker compose up`, since `./data` is the mounted volume) — this is the documented path — or temporarily `npm install tsx` in the container. Document the host-side path in the README.

- [x] **Step 3: Verify**

Run: `docker build -t bluray-test .` — Expected: image builds (better-sqlite3 compiles in the build stage).
Run: `cp .env.example .env` (leave keys empty), `docker compose up -d`, `curl -s http://localhost:3000 | grep -i collection` — Expected: HTML renders. `docker compose down`.

- [x] **Step 4: Commit**

```bash
git add Dockerfile compose.yaml .env.example README.md
git commit -m "BLU-ARCH-0002: Docker packaging — single container, /data volume, LAN-only notes"
```

---

### Task 12: Migration, parallel run, and cutover runbook

This task is operational — no new code. It executes the spec's cutover plan.

**Files:**
- Modify: `docs/work-index.md`, `docs/session-log.md` (status updates, evidence)

- [x] **Step 1: Import real data**

On the server (or locally first): `DATA_DIR=./data npm run import -- ./movies.json`
Expected: `Imported 41 movies from ./movies.json` (count matches `python3 -c "import json; print(len(json.load(open('movies.json'))['movies']))"`).

- [x] **Step 2: Full verification with evidence**

Run: `npm test` and save output. Expected: all suites pass, including the real-file round-trip test. Attach the output to `docs/work-index.md` entry for BLU-ARCH-0002 (Gate 4 evidence — per project policy, no prose-only claims).

- [ ] **Step 3: Deploy in parallel**

On the home server: `docker compose up -d` → app at `bluray.local:3000` while the old static site stays at `bluray.local:80`. Use both for several days. Parallel-run checklist:
- [ ] Library renders identically (count, posters, genres)
- [ ] Barcode scan → add works
- [ ] Cover photo ID works (if key configured) and the usage counter increments
- [ ] Watch status / rating / loan fields persist across restarts (`docker compose restart`)
- [ ] `data/exports/movies.json` appears after the first scheduled backup (or trigger by clearing meta: `sqlite3 data/bluray.db "DELETE FROM meta WHERE key='last_backup_at'"` and waiting ~30s after restart)
- [ ] With `GITHUB_TOKEN` set: backup commit appears on GitHub with `[skip ci]`

- [ ] **Step 4: Cutover**

Point the web server / reverse proxy for `bluray.local` at port 3000. Rollback = point it back at the static site (git `movies.json` is current up to cutover; anything added during parallel running exists in both only if added through the new app — during the parallel window, add movies through the NEW app only, so the nightly backup keeps git current).

- [ ] **Step 5: Update scaffold docs and hand off**

- Set BLU-ARCH-0002 → `DONE` in `docs/work-index.md` only after: tests green (evidence attached), cutover done, and the **first successful automated backup push** is verified (this is the DEC-0002 gate for deleting old code).
- Add a new work-index item for the retirement follow-up (propose `BLU-ARCH-0003`: delete `web/`, `details_scraper.py`, `tmdb_checker.py`, `scripts/`, both `requirements.txt`, the enrichment workflow; update CLAUDE.md's Files table) — it stays PLANNED until the backup-push gate passes.
- Write the session-log entry (markers, verification evidence, next actions) per `/handoff`.

```bash
git add docs/work-index.md docs/session-log.md
git commit -m "BLU-ARCH-0002: cutover complete — evidence attached, retirement follow-up filed"
```

---

## Plan Self-Review Notes

- Spec coverage: architecture (T1), repo shape (T1–T10), data model + FTS (T2), migration + round-trip (T3, T12), key flows — add/enrich (T6, T7, T9), identify (T8), backup (T10); error handling (T5–T8 validation + friendly messages, T10 failure surfacing, footer indicator T9); testing strategy (unit per service, real-file integration T3, UI smoke T9); cutover/rollback (T12); TM-0001 mitigations — LAN binding (T11 compose comment), fine-grained PAT (T11 .env.example), hard scan cap (T8), response shape-validation (T7), no-token-leak (T10 test).
- Deferred by design: local poster hosting (out of scope per owner), auth (risk-accepted), `/stats` route (queries only, later).
- Type consistency spot-checks: `rowToApi` provides `pk` used by home route mutations; `runEnrichment(pk)` signature identical between Task 6 placeholder and Task 7 real module; `startScheduler` placeholder (T9) vs real (T10); `lookupByIdentifiedTitle(title, year)` defined T5, consumed T8.

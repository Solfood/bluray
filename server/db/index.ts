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

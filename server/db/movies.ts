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

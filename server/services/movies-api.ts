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
    status: tmdbId !== null ? 'pending_enrichment' : 'needs_tmdb_match',
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

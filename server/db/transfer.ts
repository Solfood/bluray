import type { Database } from 'better-sqlite3';
import { insertMovie, rowToRecord, getMeta, setMeta } from './movies';

// DB-owned personal fields: never trust these from imported JSON. They must
// only ever be set via the app's own update paths, so any value present on
// an incoming record is stripped before insertion.
const PERSONAL_FIELDS = ['watch_status', 'personal_rating', 'loaned_to', 'loaned_at'] as const;

function stripPersonalFields(movie: any): any {
  const clean = { ...movie };
  for (const f of PERSONAL_FIELDS) delete clean[f];
  return clean;
}

export interface ImportMoviesOptions {
  /** Delete all existing rows before importing (used by `--force` in the CLI). */
  replace?: boolean;
}

export function importMoviesJson(db: Database, jsonText: string, options: ImportMoviesOptions = {}): number {
  const data = JSON.parse(jsonText);
  if (!Array.isArray(data?.movies)) throw new Error('Input must be an object with a movies array');
  const insertAll = db.transaction((movies: any[]) => {
    if (options.replace) {
      db.prepare('DELETE FROM movies').run();
    }
    for (const movie of movies) {
      if (movie.id === undefined || movie.id === null) throw new Error(`Movie missing id: ${JSON.stringify(movie).slice(0, 80)}`);
      if (typeof movie.title !== 'string' || !movie.title) throw new Error(`Movie ${movie.id} missing title`);
      if (typeof movie.added_at !== 'string' || !movie.added_at) throw new Error(`Movie ${movie.id} missing added_at`);
      insertMovie(db, stripPersonalFields(movie));
    }
  });
  insertAll(data.movies);
  if (data.updated_at) {
    setMeta(db, 'updated_at', data.updated_at);
  }
  return data.movies.length;
}

export function exportMoviesJson(db: Database): string {
  const rows = db.prepare('SELECT * FROM movies ORDER BY pk').all();
  const updated_at = getMeta(db, 'updated_at');
  const obj: any = { movies: rows.map(rowToRecord) };
  if (updated_at) {
    // Reconstruct original structure with updated_at first
    return JSON.stringify({ updated_at, movies: obj.movies }, null, 2);
  }
  return JSON.stringify(obj, null, 2);
}

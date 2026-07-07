import type { Database } from 'better-sqlite3';
import { insertMovie, rowToRecord, getMeta, setMeta } from './movies';

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

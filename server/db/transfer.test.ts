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

  it('strips personal fields from input records instead of importing them', () => {
    const db = freshDb();
    const input = JSON.stringify({
      movies: [
        {
          id: 1,
          title: 'Personal Fields Movie',
          added_at: '2026-01-01T00:00:00.000Z',
          watch_status: 'watched',
          personal_rating: 5,
          loaned_to: 'Sam',
          loaned_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    importMoviesJson(db, input);
    const out = JSON.parse(exportMoviesJson(db));
    expect(out.movies).toHaveLength(1);
    const exported = out.movies[0];
    expect(exported.watch_status).toBeUndefined();
    expect(exported.personal_rating).toBeUndefined();
    expect(exported.loaned_to).toBeUndefined();
    expect(exported.loaned_at).toBeUndefined();

    const row = db.prepare('SELECT * FROM movies WHERE id = ?').get('1') as any;
    expect(row.watch_status).toBe('unwatched');
    expect(row.personal_rating).toBeNull();
    expect(row.loaned_to).toBeNull();
    expect(row.loaned_at).toBeNull();
  });

  it('replace mode deletes existing rows before importing so re-import does not duplicate', () => {
    const db = freshDb();
    const input = JSON.stringify({
      movies: [
        { id: 1, title: 'First', added_at: '2026-01-01T00:00:00.000Z' },
        { id: 2, title: 'Second', added_at: '2026-01-02T00:00:00.000Z' },
      ],
    });
    importMoviesJson(db, input);
    importMoviesJson(db, input, { replace: true });
    const count = (db.prepare('SELECT COUNT(*) AS n FROM movies').get() as any).n;
    expect(count).toBe(2);
  });
});

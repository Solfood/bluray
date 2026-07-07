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

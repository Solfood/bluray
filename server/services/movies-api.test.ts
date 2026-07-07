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

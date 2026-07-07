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

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

  it('caps genres array at 20 items', async () => {
    // Create TMDB response with 25 genres
    const genresArray = Array.from({ length: 25 }, (_, i) => ({ name: `G${i + 1}` }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      runtime: 120,
      production_countries: [],
      spoken_languages: [],
      genres: genresArray,
      tagline: '',
      overview: 'Test',
    }))));
    const { runEnrichment } = await import('./enrich');
    const pk = insertMovie(db, { id: 2, tmdb_id: 2, title: 'Many Genres', added_at: '2026-01-01T00:00:00.000Z', status: 'pending_enrichment' });
    await runEnrichment(pk);
    const rec = rowToRecord(getMovie(db, pk));
    expect(rec.genres).toHaveLength(20);
    expect(rec.genres).toEqual(Array.from({ length: 20 }, (_, i) => `G${i + 1}`));
  });
});

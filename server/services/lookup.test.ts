import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lookupQuery } from './lookup';

const tmdbSearchResponse = {
  results: [
    { id: 1422, title: 'The Departed', release_date: '2006-10-04', overview: 'Mole.', poster_path: '/x.jpg' },
    { id: 999, title: 'Departure', release_date: '2019-05-01', overview: 'Other.', poster_path: null },
  ],
};

beforeEach(() => {
  process.env.TMDB_API_KEY = 'test-key';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/search/movie')) return new Response(JSON.stringify(tmdbSearchResponse));
    if (u.includes('/find/')) return new Response(JSON.stringify({ movie_results: [] }));
    // Open DB indexes + upcitemdb: not found
    return new Response('not found', { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lookupQuery', () => {
  it('title search returns ranked candidates with _score and _source', async () => {
    const result = await lookupQuery('The Departed');
    expect(result.candidates[0].title).toBe('The Departed');
    expect(result.candidates[0]._source).toBe('tmdb');
    expect(result.candidates[0]._score).toBeGreaterThan(result.candidates[1]._score);
  });

  it('unmatched title falls back to a manual-entry candidate', async () => {
    (fetch as any).mockImplementation(async () => new Response(JSON.stringify({ results: [] })));
    const result = await lookupQuery('Zzzz Unknown Movie');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]._source).toBe('manual-title');
  });

  it('barcode not found anywhere returns not_found status with no candidates', async () => {
    const result = await lookupQuery('883929800815');
    expect(result.status).toBe('not_found');
    expect(result.candidates).toEqual([]);
  });

  it('caches repeated queries in-memory', async () => {
    await lookupQuery('The Departed cache-test');
    const callsAfterFirst = (fetch as any).mock.calls.length;
    await lookupQuery('The Departed cache-test');
    expect((fetch as any).mock.calls.length).toBe(callsAfterFirst);
  });
});

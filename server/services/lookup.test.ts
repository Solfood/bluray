import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lookupQuery, __resetOpenDbStateForTests } from './lookup';

const tmdbSearchResponse = {
  results: [
    { id: 1422, title: 'The Departed', release_date: '2006-10-04', overview: 'Mole.', poster_path: '/x.jpg' },
    { id: 999, title: 'Departure', release_date: '2019-05-01', overview: 'Other.', poster_path: null },
  ],
};

beforeEach(() => {
  process.env.TMDB_API_KEY = 'test-key';
  __resetOpenDbStateForTests();
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
  vi.useRealTimers();
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

  it('barcode: OpenDB record with no direct TMDB hit is used to drive a TMDB title search', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/search/movie')) return new Response(JSON.stringify(tmdbSearchResponse));
      if (u.includes('/find/')) return new Response(JSON.stringify({ movie_results: [] }));
      if (u.includes('upc_index.json')) {
        return new Response(JSON.stringify({
          index: {
            '111111111111': { title: 'The Departed', year: 2006, edition: 'Steelbook', source: 'open-db-index' },
          },
        }));
      }
      if (u.includes('title_index.json')) return new Response(JSON.stringify({ index: {} }));
      return new Response('not found', { status: 404 });
    }));

    const result = await lookupQuery('111111111111');
    expect(result.status).toBe('ok');
    expect(result.candidates[0].title).toBe('The Departed');
    expect(result.candidates[0]._source).toBe('tmdb');
    expect(result.candidates[0]._score).toBeGreaterThan(result.candidates[1]._score);
    expect(result.detectedEdition).toBe('Steelbook');
  });

  it('barcode: OpenDB record with no TMDB match anywhere falls back to a single open-db-index candidate', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/search/movie')) return new Response(JSON.stringify({ results: [] }));
      if (u.includes('/find/')) return new Response(JSON.stringify({ movie_results: [] }));
      if (u.includes('upc_index.json')) {
        return new Response(JSON.stringify({
          index: {
            '222222222222': { title: 'Obscure Import', year: 2001, edition: '', source: 'open-db-index' },
          },
        }));
      }
      if (u.includes('title_index.json')) return new Response(JSON.stringify({ index: {} }));
      return new Response('not found', { status: 404 });
    }));

    const result = await lookupQuery('222222222222');
    expect(result.status).toBe('ok');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]._source).toBe('open-db-index');
    expect(result.candidates[0]._score).toBe(70);
    expect(result.detectedEdition).toBe('Obscure Import');
  });

  it('barcode: falls back to upcitemdb title lookup, then TMDB search, when TMDB and OpenDB both miss', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/search/movie')) {
        return new Response(JSON.stringify({
          results: [{ id: 603, title: 'The Matrix', release_date: '1999-03-30', overview: 'A hacker...' }],
        }));
      }
      if (u.includes('/find/')) return new Response(JSON.stringify({ movie_results: [] }));
      if (u.includes('upc_index.json')) return new Response(JSON.stringify({ index: {} }));
      if (u.includes('title_index.json')) return new Response(JSON.stringify({ index: {} }));
      if (u.includes('api.upcitemdb.com')) {
        return new Response(JSON.stringify({ items: [{ title: 'The Matrix 4K Ultra HD Blu-ray' }] }));
      }
      return new Response('not found', { status: 404 });
    }));

    const result = await lookupQuery('333333333333');
    expect(result.status).toBe('ok');
    expect(result.candidates[0].title).toBe('The Matrix');
    expect(result.candidates[0]._source).toBe('tmdb');
    expect(result.detectedEdition).toBe('The Matrix 4K Ultra HD Blu-ray');
  });

  it('regression (Finding 1): a total OpenDB fetch failure does not permanently disable the tier', async () => {
    // Mechanism: fake timers, so we can assert the real OPEN_DB_RETRY_MS cooldown
    // (rather than just re-running __resetOpenDbStateForTests, which would only prove
    // the reset helper works, not that the production retry path does).
    vi.useFakeTimers();

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/search/movie')) return new Response(JSON.stringify({ results: [] }));
      if (u.includes('/find/')) return new Response(JSON.stringify({ movie_results: [] }));
      // Both OpenDB indexes fail.
      return new Response('not found', { status: 404 });
    }));

    const first = await lookupQuery('444444444401');
    expect(first.status).toBe('not_found');

    // Advance past the 5-minute cooldown so the next call is eligible to retry.
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/search/movie')) return new Response(JSON.stringify({ results: [] }));
      if (u.includes('/find/')) return new Response(JSON.stringify({ movie_results: [] }));
      if (u.includes('upc_index.json')) {
        return new Response(JSON.stringify({
          index: {
            '444444444402': { title: 'Regression Fixture', year: 2020, edition: '', source: 'open-db-index' },
          },
        }));
      }
      if (u.includes('title_index.json')) return new Response(JSON.stringify({ index: {} }));
      return new Response('not found', { status: 404 });
    }));

    // Different barcode so we don't hit the result cache from the first call.
    const second = await lookupQuery('444444444402');
    expect(second.candidates[0]?._source).toBe('open-db-index');
    expect(second.candidates[0]?._score).toBe(70);
  });
});

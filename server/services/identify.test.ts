import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/index';
import { identifyCover, getMonthlyUsage } from './identify';

let db: ReturnType<typeof createDb>;
const B64 = 'aGVsbG8='; // tiny valid base64

const anthropicOk = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: 'text', text }] }));

beforeEach(() => {
  db = createDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bluray-test-')), 't.db'));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.TMDB_API_KEY = 'test-key';
  process.env.SCAN_MONTHLY_CAP = '200';
});

afterEach(() => vi.unstubAllGlobals());

describe('identifyCover', () => {
  it('identifies, records usage, and returns TMDB candidates', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('anthropic.com')) return anthropicOk('{"title":"The Departed","year":2006,"edition":"4K Ultra HD"}');
      if (String(url).includes('/search/movie')) return new Response(JSON.stringify({ results: [{ id: 1422, title: 'The Departed', release_date: '2006-10-04' }] }));
      return new Response('nf', { status: 404 });
    }));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.identified.title).toBe('The Departed');
    expect(res.candidates[0].id).toBe(1422);
    expect(getMonthlyUsage(db).scans).toBe(1);
  });

  it('strips code fences from the model reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('anthropic.com')
        ? anthropicOk('```json\n{"title":"In Bruges","year":2008}\n```')
        : new Response(JSON.stringify({ results: [] }))
    ));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.identified.title).toBe('In Bruges');
  });

  it('enforces the hard monthly cap with 429 and never calls the API', async () => {
    process.env.SCAN_MONTHLY_CAP = '2';
    const month = new Date().toISOString().slice(0, 7);
    const stmt = db.prepare('INSERT INTO scan_usage (month, created_at) VALUES (?, ?)');
    stmt.run(month, new Date().toISOString());
    stmt.run(month, new Date().toISOString());
    const fetchSpy = vi.fn(async () => anthropicOk('{"title":null}'));
    vi.stubGlobal('fetch', fetchSpy);
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.status).toBe(429);
    expect(res.error).toMatch(/cap/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the default cap of 200 when SCAN_MONTHLY_CAP is not a number', async () => {
    process.env.SCAN_MONTHLY_CAP = 'banana';
    const month = new Date().toISOString().slice(0, 7);
    const stmt = db.prepare('INSERT INTO scan_usage (month, created_at) VALUES (?, ?)');
    for (let i = 0; i < 200; i++) stmt.run(month, new Date().toISOString());
    const fetchSpy = vi.fn(async () => anthropicOk('{"title":null}'));
    vi.stubGlobal('fetch', fetchSpy);
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the default cap of 200 when SCAN_MONTHLY_CAP is negative', async () => {
    process.env.SCAN_MONTHLY_CAP = '-5';
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('anthropic.com')
        ? anthropicOk('{"title":null}')
        : new Response(JSON.stringify({ results: [] }))
    ));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.status).toBeUndefined(); // 0 scans < 200 default → proceeds
    expect(res).toHaveProperty('identified', null);
  });

  it('reserves a usage slot before calling the API (closes the concurrent TOCTOU window)', async () => {
    let scansAtFetchTime = -1;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('anthropic.com')) {
        scansAtFetchTime = getMonthlyUsage(db).scans;
        return anthropicOk('{"title":null}');
      }
      return new Response(JSON.stringify({ results: [] }));
    }));
    await identifyCover(db, B64, 'image/jpeg');
    expect(scansAtFetchTime).toBe(1); // reservation inserted before fetch
    expect(getMonthlyUsage(db).scans).toBe(1); // and kept on success
  });

  it('rejects oversized and wrong-type images with 400', async () => {
    expect(((await identifyCover(db, 'x'.repeat(1_400_001), 'image/jpeg')) as any).status).toBe(400);
    expect(((await identifyCover(db, B64, 'image/gif')) as any).status).toBe(400);
  });

  it('maps Anthropic API errors to friendly messages without recording usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'bad key' } }), { status: 401 })
    ));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.error).toMatch(/Anthropic API key/);
    expect(res.status).toBe(502);
    expect(getMonthlyUsage(db).scans).toBe(0); // reservation released on failure
  });

  it('maps permission/credit errors to the billing message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { type: 'permission_error', message: 'no access' } }), { status: 403 })
    ));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.error).toMatch(/credits exhausted/i);
    expect(res.status).toBe(502);
    expect(getMonthlyUsage(db).scans).toBe(0);
  });

  it('maps rate limit errors (429) to the wait message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }), { status: 429 })
    ));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.error).toMatch(/rate limited/i);
    expect(res.status).toBe(502);
    expect(getMonthlyUsage(db).scans).toBe(0);
  });

  it('maps overloaded errors (529) to the try-again message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { type: 'overloaded_error', message: 'busy' } }), { status: 529 })
    ));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.error).toMatch(/overloaded/i);
    expect(res.status).toBe(502);
    expect(getMonthlyUsage(db).scans).toBe(0);
  });

  it('returns 503 when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.status).toBe(503);
    expect(res.error).toMatch(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns identified: null and records usage when the model cannot identify', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => anthropicOk('{"title":null}')));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.identified).toBeNull();
    expect(res.usage.scans).toBe(1); // successful API call → usage recorded
    expect(getMonthlyUsage(db).scans).toBe(1);
  });

  it('returns a friendly 502 on network failure and leaves the scan count unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.status).toBe(502);
    expect(res.error).toMatch(/network error/i);
    expect(getMonthlyUsage(db).scans).toBe(0); // reservation released
  });

  it('releases the reservation on an unparseable model reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => anthropicOk('definitely not json')));
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.status).toBe(502);
    expect(res.error).toMatch(/Unexpected model response/);
    expect(getMonthlyUsage(db).scans).toBe(0);
  });
});

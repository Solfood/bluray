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

  it('enforces the hard monthly cap with 429', async () => {
    process.env.SCAN_MONTHLY_CAP = '2';
    const month = new Date().toISOString().slice(0, 7);
    const stmt = db.prepare('INSERT INTO scan_usage (month, created_at) VALUES (?, ?)');
    stmt.run(month, new Date().toISOString());
    stmt.run(month, new Date().toISOString());
    const res: any = await identifyCover(db, B64, 'image/jpeg');
    expect(res.status).toBe(429);
    expect(res.error).toMatch(/cap/i);
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
    expect(getMonthlyUsage(db).scans).toBe(0);
  });
});

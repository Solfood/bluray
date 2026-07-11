import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/index';
import { insertMovie, getMeta } from '../db/movies';
import { runBackup } from './backup';

let db: ReturnType<typeof createDb>;
let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluray-test-'));
  process.env.DATA_DIR = dataDir;
  db = createDb(path.join(dataDir, 'bluray.db'));
  insertMovie(db, { id: 1422, title: 'The Departed', added_at: '2026-01-01T00:00:00.000Z' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPO;
});

describe('runBackup', () => {
  it('writes the export file and records success even without a GitHub token', async () => {
    const result = await runBackup(db);
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(false);
    const exported = JSON.parse(fs.readFileSync(path.join(dataDir, 'exports', 'movies.json'), 'utf8'));
    expect(exported.movies[0].title).toBe('The Departed');
    expect(getMeta(db, 'last_backup_at')).toBeTruthy();
    expect(getMeta(db, 'last_backup_ok')).toBe('true');
  });

  it('pushes via the GitHub contents API with existing sha and [skip ci]', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_REPO = 'Solfood/bluray';
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: any = {}) => {
      calls.push({ url: String(url), opts });
      if (!opts.method) return new Response(JSON.stringify({ sha: 'abc123' }));
      return new Response(JSON.stringify({ commit: { sha: 'def' } }));
    }));
    const result = await runBackup(db);
    expect(result.pushed).toBe(true);
    const put = calls.find((c) => c.opts.method === 'PUT');
    expect(put.url).toBe('https://api.github.com/repos/Solfood/bluray/contents/movies.json');
    const body = JSON.parse(put.opts.body);
    expect(body.sha).toBe('abc123');
    expect(body.message).toContain('[skip ci]');
    expect(Buffer.from(body.content, 'base64').toString()).toContain('The Departed');
  });

  it('marks failure without leaking the token', async () => {
    process.env.GITHUB_TOKEN = 'sekrit-token';
    process.env.GITHUB_REPO = 'Solfood/bluray';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const result = await runBackup(db);
    expect(result.ok).toBe(false);
    expect(getMeta(db, 'last_backup_ok')).toBe('false');
    expect(result.error).not.toContain('sekrit-token');
  });
});

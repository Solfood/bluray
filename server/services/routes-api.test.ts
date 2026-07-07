import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { action as moviesAction } from '../../app/routes/api.movies';
import { action as moviePkAction } from '../../app/routes/api.movies.$pk';

declare global {
  // eslint-disable-next-line no-var
  var __blurayDb: import('better-sqlite3').Database | undefined;
}

beforeEach(() => {
  globalThis.__blurayDb = undefined;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bluray-route-test-'));
});

function jsonRequest(method: string, body: unknown) {
  return new Request('http://localhost/api/movies', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/movies', () => {
  it('creates a movie with a valid body and returns 201 pending_enrichment', async () => {
    const request = jsonRequest('POST', { tmdb_id: 1422, title: 'The Departed' });
    const response: any = await moviesAction({ request, params: {}, context: {} } as any);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe('pending_enrichment');
    expect(body.title).toBe('The Departed');
  });

  it('rejects a scalar JSON body with 400', async () => {
    const request = jsonRequest('POST', '5');
    const response: any = await moviesAction({ request, params: {}, context: {} } as any);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid json body/i);
  });
});

describe('PATCH /api/movies/:pk', () => {
  it('rejects a scalar JSON body with 400 (regression for truthy-scalar guard bypass)', async () => {
    const createReq = jsonRequest('POST', { title: 'Regression Target' });
    const createRes: any = await moviesAction({ request: createReq, params: {}, context: {} } as any);
    const created = await createRes.json();

    const request = new Request(`http://localhost/api/movies/${created.pk}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'true',
    });
    const response: any = await moviePkAction({
      request,
      params: { pk: String(created.pk) },
      context: {},
    } as any);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid json body/i);
  });

  it('returns 405 for a GET request', async () => {
    const request = new Request('http://localhost/api/movies/1', { method: 'GET' });
    const response: any = await moviePkAction({ request, params: { pk: '1' }, context: {} } as any);
    expect(response.status).toBe(405);
  });
});

describe('DELETE /api/movies/:pk', () => {
  it('returns 404 for a missing pk', async () => {
    const request = new Request('http://localhost/api/movies/99999', { method: 'DELETE' });
    const response: any = await moviePkAction({
      request,
      params: { pk: '99999' },
      context: {},
    } as any);
    expect(response.status).toBe(404);
  });
});

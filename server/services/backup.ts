import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { exportMoviesJson } from '../db/transfer';
import { setMeta } from '../db/movies';

async function pushToGitHub(json: string): Promise<void> {
  const repo = process.env.GITHUB_REPO!;
  const url = `https://api.github.com/repos/${repo}/contents/movies.json`;
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  const currentRes = await fetch(url, { headers });
  const current: any = currentRes.ok ? await currentRes.json() : null;

  const putRes = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: 'Nightly backup of movies.json [skip ci]',
      content: Buffer.from(json).toString('base64'),
      ...(current?.sha ? { sha: current.sha } : {}),
    }),
  });
  if (!putRes.ok) throw new Error(`GitHub push failed with status ${putRes.status}`);
}

export async function runBackup(db: Database): Promise<{ ok: boolean; pushed: boolean; error?: string }> {
  const json = exportMoviesJson(db);
  const exportsDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.writeFileSync(path.join(exportsDir, 'movies.json'), json);

  const canPush = Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
  if (canPush) {
    try {
      await pushToGitHub(json);
    } catch (e: any) {
      setMeta(db, 'last_backup_ok', 'false');
      // Message is constructed above without headers/token; safe to surface.
      return { ok: false, pushed: false, error: e.message };
    }
  }

  setMeta(db, 'last_backup_at', new Date().toISOString());
  setMeta(db, 'last_backup_ok', 'true');
  return { ok: true, pushed: canPush };
}

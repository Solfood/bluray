import { getDb } from './db/index';
import { getMeta } from './db/movies';
import { runBackup } from './services/backup';

const DAY_MS = 24 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __blurayScheduler: boolean | undefined;
}

export function startScheduler(): void {
  if (globalThis.__blurayScheduler) return;
  globalThis.__blurayScheduler = true;

  const tick = async () => {
    try {
      const db = getDb();
      const last = getMeta(db, 'last_backup_at');
      if (!last || Date.now() - Date.parse(last) > DAY_MS) {
        const result = await runBackup(db);
        if (!result.ok) console.error('[backup]', result.error);
        else console.log(`[backup] exported${result.pushed ? ' and pushed' : ''}`);
      }
    } catch (e) {
      console.error('[backup] tick failed', e);
    }
  };

  setTimeout(tick, 30_000);
  setInterval(tick, 60 * 60 * 1000);
}

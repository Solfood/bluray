import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './index';
import { importMoviesJson } from './transfer';

const args = process.argv.slice(2).filter((a) => a !== '--force');
const force = process.argv.includes('--force');
const file = args[0] || path.resolve(process.cwd(), 'movies.json');

const db = getDb();
const existing = (db.prepare('SELECT COUNT(*) AS n FROM movies').get() as any).n;
if (existing > 0 && !force) {
  console.error(`Database already has ${existing} movies. Re-run with --force to import anyway.`);
  process.exit(1);
}

const count = importMoviesJson(db, fs.readFileSync(file, 'utf8'), { replace: force });
console.log(`Imported ${count} movies from ${file}`);

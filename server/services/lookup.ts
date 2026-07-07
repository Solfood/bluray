import {
  normalizeTitle, buildTitleVariants, safeYear,
  normalizeScanOrInput, buildUpcCandidates, scoreMovieCandidate,
} from '../../app/lib/movies.js';
import { searchMovie, findByUpc, fetchJsonWithRetry } from './tmdb';

const OPEN_DB_BASE_URL = 'https://raw.githubusercontent.com/Solfood/bluray-database/main';
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const CACHE_MAX = 120;

const cache = new Map<string, { ts: number; value: LookupResult }>();
let openDbIndexes: { loaded: boolean; upc: any; title: any } = { loaded: false, upc: null, title: null };

export interface LookupResult {
  status: 'ok' | 'not_found';
  candidates: any[];
  detectedEdition: string;
}

async function loadOpenDbIndexes() {
  if (openDbIndexes.loaded) return openDbIndexes;
  const [upcIndex, titleIndex] = await Promise.all([
    fetchJsonWithRetry(`${OPEN_DB_BASE_URL}/upc_index.json`, 1, 500, 6000).catch(() => null),
    fetchJsonWithRetry(`${OPEN_DB_BASE_URL}/title_index.json`, 1, 500, 6000).catch(() => null),
  ]);
  openDbIndexes = {
    loaded: true,
    upc: upcIndex?.index || upcIndex || null,
    title: titleIndex?.index || titleIndex || null,
  };
  return openDbIndexes;
}

async function lookupOpenDbByUpc(rawUpc: string) {
  const variants = buildUpcCandidates(rawUpc);
  if (variants.length === 0) return null;
  const indexes = await loadOpenDbIndexes().catch(() => ({ upc: null } as any));
  if (!indexes?.upc) return null;
  for (const upc of variants) {
    if (indexes.upc[upc]) return { ...indexes.upc[upc], upc, source: 'open-db-index' };
  }
  return null;
}

async function lookupOpenDbByTitle(title: string) {
  const normalized = normalizeTitle(title);
  if (!normalized) return [];
  const indexes = await loadOpenDbIndexes().catch(() => ({ title: null } as any));
  const entry = indexes?.title?.[normalized];
  if (!entry) return [];
  const records = Array.isArray(entry) ? entry : [entry];
  return records.map((r: any) => ({
    id: null,
    title: r.title,
    release_date: r.year ? `${r.year}-01-01` : '',
    overview: 'Found in Open Database.',
    note: r.edition || '',
    _source: 'open-db-title-index',
    _score: 45,
  }));
}

async function lookupUpcItemDb(upc: string) {
  const data = await fetchJsonWithRetry(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`, 1, 700, 7000
  ).catch(() => null);
  const rawTitle = data?.items?.[0]?.title?.trim();
  if (!rawTitle) return null;
  const titleCandidates = buildTitleVariants(rawTitle);
  return { rawTitle, cleanTitle: titleCandidates[0] || rawTitle, titleCandidates };
}

function rankTmdbResults(results: any[], preferredTitle = '', preferredYear: number | null = null) {
  const unique: any[] = [];
  const seen = new Set<string>();
  for (const item of results || []) {
    const key = item.id
      ? `id:${item.id}`
      : `t:${normalizeTitle(item.title)}:${safeYear(item.release_date) || 'na'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique
    .map((item) => ({ ...item, _score: scoreMovieCandidate(item, preferredTitle, preferredYear), _source: 'tmdb' }))
    .sort((a, b) => b._score - a._score);
}

async function searchTmdbByTitleCandidates(titles: string[], preferredTitle = '', preferredYear: number | null = null) {
  const queries = [...new Set((titles || []).filter(Boolean))].slice(0, 3);
  if (queries.length === 0) return [];
  const results = await Promise.all(queries.map((t) => searchMovie(t).catch(() => [])));
  return rankTmdbResults(results.flat(), preferredTitle || queries[0], preferredYear);
}

export async function lookupByIdentifiedTitle(title: string, year: number | null): Promise<any[]> {
  return searchTmdbByTitleCandidates(buildTitleVariants(title), title, year);
}

function cacheSet(key: string, value: LookupResult) {
  cache.set(key, { ts: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

export async function lookupQuery(rawQuery: string): Promise<LookupResult> {
  const query = normalizeScanOrInput(rawQuery);
  if (!query) return { status: 'not_found', candidates: [], detectedEdition: '' };

  const cached = cache.get(query);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const isBarcode = /^\d{8,14}$/.test(query);
  let detectedEdition = '';
  let result: LookupResult;

  if (!isBarcode) {
    const [openDbTitleCandidates, tmdbResults] = await Promise.all([
      lookupOpenDbByTitle(query),
      searchMovie(query).catch(() => []),
    ]);
    const merged = [...rankTmdbResults(tmdbResults, query, null), ...openDbTitleCandidates];
    result = merged.length > 0
      ? { status: 'ok', candidates: merged.slice(0, 8), detectedEdition: '' }
      : {
          status: 'ok',
          detectedEdition: '',
          candidates: [{
            id: null, title: query, release_date: '',
            overview: 'Manual title entry. TMDB match unavailable.',
            note: '', _source: 'manual-title', _score: 1,
          }],
        };
    cacheSet(query, result);
    return result;
  }

  // Barcode path
  const [tmdbDirect, openDbRecord] = await Promise.all([
    (async () => {
      const upcs = buildUpcCandidates(query).slice(0, 2);
      const responses = await Promise.all(upcs.map((u) => findByUpc(u).catch(() => [])));
      return responses.flat();
    })(),
    lookupOpenDbByUpc(query),
  ]);

  let tmdbResults = tmdbDirect;
  let preferredTitle = '';
  let preferredYear: number | null = null;

  if (openDbRecord) {
    preferredTitle = (openDbRecord.title || '').trim();
    preferredYear = safeYear(openDbRecord.year);
    detectedEdition = openDbRecord.edition || openDbRecord.title || '';
    if (preferredTitle && tmdbResults.length === 0) {
      tmdbResults = await searchTmdbByTitleCandidates(buildTitleVariants(preferredTitle), preferredTitle, preferredYear);
    }
  }

  const ranked = tmdbResults[0]?._score !== undefined
    ? tmdbResults
    : rankTmdbResults(tmdbResults, preferredTitle, preferredYear);

  if (ranked.length > 0) {
    result = { status: 'ok', candidates: ranked.slice(0, 8), detectedEdition };
  } else if (openDbRecord) {
    result = {
      status: 'ok',
      detectedEdition,
      candidates: [{
        id: null,
        title: openDbRecord.title,
        release_date: openDbRecord.year ? `${openDbRecord.year}-01-01` : '',
        overview: 'Found in Open Database. TMDB details unavailable.',
        note: openDbRecord.edition || '',
        _source: openDbRecord.source,
        _score: 70,
      }],
    };
  } else {
    let upcFallback = null;
    for (const upc of buildUpcCandidates(query)) {
      upcFallback = await lookupUpcItemDb(upc);
      if (upcFallback) break;
    }
    if (upcFallback) {
      detectedEdition = upcFallback.rawTitle;
      const fallbackRanked = await searchTmdbByTitleCandidates(
        upcFallback.titleCandidates, upcFallback.cleanTitle, null
      );
      result = fallbackRanked.length > 0
        ? { status: 'ok', candidates: fallbackRanked.slice(0, 8), detectedEdition }
        : {
            status: 'ok',
            detectedEdition,
            candidates: [{
              id: null, title: upcFallback.cleanTitle, release_date: '',
              overview: 'Found by UPC lookup, but TMDB match is unavailable.',
              note: upcFallback.rawTitle, _source: 'upcitemdb', _score: 55,
            }],
          };
    } else {
      result = { status: 'not_found', candidates: [], detectedEdition: '' };
    }
  }

  cacheSet(query, result);
  return result;
}

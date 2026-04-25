import { useState, useEffect, useRef } from 'react';
import {
  normalizeTitle, buildTitleVariants, safeYear,
  normalizeScanOrInput, buildUpcCandidates, scoreMovieCandidate,
} from '../utils/movies';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const OPEN_DB_BASE_URL = 'https://raw.githubusercontent.com/Solfood/bluray-database/main';
const LOOKUP_CACHE_KEY = 'bluray_lookup_cache_v1';
const LOOKUP_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function useLookup(keys) {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [movieData, setMovieData] = useState(null);
  const [searchCandidates, setSearchCandidates] = useState([]);
  const [scannedCode, setScannedCode] = useState('');
  const [userNote, setUserNote] = useState('');

  const openDbIndexesRef = useRef({ loaded: false, upc: null, title: null });
  const lookupCacheRef = useRef(new Map());
  const activeSearchRef = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOOKUP_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const now = Date.now();
      const valid = parsed.filter(([, value]) => value?.ts && now - value.ts < LOOKUP_CACHE_TTL_MS);
      lookupCacheRef.current = new Map(valid);
    } catch (e) {
      console.warn('Lookup cache restore failed', e);
    }
  }, []);

  const reset = () => {
    setMovieData(null);
    setSearchCandidates([]);
    setScannedCode('');
    setUserNote('');
    setStatusMsg('');
    setLoading(false);
  };

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 7000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const fetchJsonWithRetry = async (url, options = {}, retries = 2, backoff = 600, timeoutMs = 7000) => {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      if (!res.ok) {
        if (retries > 0 && res.status >= 500) throw new Error(`Status ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      if (retries > 0) {
        await sleep(backoff);
        return fetchJsonWithRetry(url, options, retries - 1, Math.floor(backoff * 1.5), timeoutMs);
      }
      throw e;
    }
  };

  const writeLookupCache = () => {
    try {
      localStorage.setItem(LOOKUP_CACHE_KEY, JSON.stringify([...lookupCacheRef.current.entries()].slice(-120)));
    } catch (e) {
      console.warn('Lookup cache write failed', e);
    }
  };

  const setLookupCacheEntry = (key, value) => {
    if (!key || !value) return;
    lookupCacheRef.current.set(key, { ...value, ts: Date.now() });
    if (lookupCacheRef.current.size > 120) {
      const first = lookupCacheRef.current.keys().next().value;
      lookupCacheRef.current.delete(first);
    }
    writeLookupCache();
  };

  const loadOpenDbIndexes = async () => {
    if (openDbIndexesRef.current.loaded) return openDbIndexesRef.current;

    const [upcIndex, titleIndex] = await Promise.all([
      fetchJsonWithRetry(`${OPEN_DB_BASE_URL}/upc_index.json`, {}, 1, 500, 6000).catch(() => null),
      fetchJsonWithRetry(`${OPEN_DB_BASE_URL}/title_index.json`, {}, 1, 500, 6000).catch(() => null),
    ]);

    openDbIndexesRef.current = {
      loaded: true,
      upc: upcIndex?.index || upcIndex || null,
      title: titleIndex?.index || titleIndex || null,
    };

    return openDbIndexesRef.current;
  };

  const lookupOpenDbByUpc = async (rawUpc) => {
    const upcVariants = buildUpcCandidates(rawUpc);
    if (upcVariants.length === 0) return null;

    const indexes = await loadOpenDbIndexes().catch(() => ({ upc: null }));
    if (!indexes?.upc) return null;

    for (const upc of upcVariants) {
      if (indexes.upc[upc]) {
        return { ...indexes.upc[upc], upc, source: 'open-db-index' };
      }
    }

    return null;
  };

  const lookupOpenDbByTitle = async (title) => {
    const normalized = normalizeTitle(title);
    if (!normalized) return [];

    const indexes = await loadOpenDbIndexes().catch(() => ({ title: null }));
    const entry = indexes?.title?.[normalized];
    if (!entry) return [];

    const records = Array.isArray(entry) ? entry : [entry];
    return records.map((r) => ({
      id: null,
      title: r.title,
      release_date: r.year ? `${r.year}-01-01` : '',
      overview: 'Found in Open Database.',
      note: r.edition || '',
      _source: 'open-db-title-index',
      _score: 45,
    }));
  };

  const lookupUpcItemDb = async (upc) => {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`)}`;
    const data = await fetchJsonWithRetry(proxyUrl, {}, 1, 700, 7000).catch(() => null);
    const rawTitle = data?.items?.[0]?.title?.trim();
    if (!rawTitle) return null;

    const titleCandidates = buildTitleVariants(rawTitle);
    const cleanTitle = titleCandidates[0] || rawTitle;
    return { rawTitle, cleanTitle, titleCandidates };
  };

  const rankTmdbResults = (results, preferredTitle = '', preferredYear = null) => {
    const unique = [];
    const seen = new Set();

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
  };

  const searchTmdbByTitleCandidates = async (titles, preferredTitle = '', preferredYear = null) => {
    if (!keys.tmdb) return [];
    const queries = [...new Set((titles || []).filter(Boolean))].slice(0, 3);
    if (queries.length === 0) return [];

    const results = await Promise.all(
      queries.map((title) =>
        fetchJsonWithRetry(
          `${TMDB_BASE_URL}/search/movie?api_key=${keys.tmdb}&query=${encodeURIComponent(title)}`,
          {},
          1,
          400,
          4500
        ).catch(() => null)
      )
    );

    const merged = results.flatMap((r) => r?.results || []);
    return rankTmdbResults(merged, preferredTitle || queries[0], preferredYear);
  };

  const lookupTmdbByUpc = async (upcRaw) => {
    if (!keys.tmdb) return [];
    const upcs = buildUpcCandidates(upcRaw);
    if (!upcs.length) return [];

    const responses = await Promise.all(
      upcs.slice(0, 2).map((upc) =>
        fetchJsonWithRetry(
          `${TMDB_BASE_URL}/find/${upc}?api_key=${keys.tmdb}&external_source=upc`,
          {},
          1,
          450,
          4000
        ).catch(() => null)
      )
    );

    return responses.flatMap((r) => r?.movie_results || []);
  };

  const selectMovieCandidate = (candidate, detectedEdition = '') => {
    if (!candidate) return;
    const merged = {
      ...candidate,
      detected_edition: detectedEdition,
      note: candidate.note || detectedEdition || '',
    };
    setMovieData(merged);
    setUserNote(merged.note || '');
    setStatusMsg('Movie selected.');
  };

  const chooseCandidates = (candidates, detectedEdition = '') => {
    if (!candidates || candidates.length === 0) {
      setMovieData(null);
      setSearchCandidates([]);
      return;
    }

    if (candidates.length === 1) {
      setSearchCandidates(candidates);
      selectMovieCandidate(candidates[0], detectedEdition);
      return;
    }

    const top = candidates[0];
    const second = candidates[1];
    const confidentAutoPick = top._score >= 120 && (!second || top._score - second._score >= 25);

    setSearchCandidates(candidates.slice(0, 8));

    if (confidentAutoPick) {
      selectMovieCandidate(top, detectedEdition);
    } else {
      setMovieData(null);
      setUserNote(detectedEdition || '');
      setStatusMsg('Multiple matches found. Choose the correct movie.');
    }
  };

  const searchTMDB = async (query) => {
    const normalizedQuery = normalizeScanOrInput(query);
    if (!normalizedQuery) {
      setStatusMsg('Enter a title or UPC.');
      return;
    }

    const searchId = Date.now();
    activeSearchRef.current = searchId;

    const cached = lookupCacheRef.current.get(normalizedQuery);
    if (cached && Date.now() - cached.ts < LOOKUP_CACHE_TTL_MS) {
      setLoading(false);
      setStatusMsg('Loaded instantly from recent scan.');
      chooseCandidates(cached.candidates || [], cached.detectedEdition || '');
      return;
    }

    setLoading(true);
    setStatusMsg('Searching...');
    setMovieData(null);
    setSearchCandidates([]);

    let detectedEdition = '';

    try {
      const isBarcode = /^\d{8,14}$/.test(normalizedQuery);
      let preferredTitle = '';
      let preferredYear = null;
      let tmdbResults = [];
      let openDbRecord = null;

      if (isBarcode) {
        if (keys.tmdb) {
          setStatusMsg(`Analyzing barcode: ${normalizedQuery}...`);
          const [tmdbDirect, openDbDirect] = await Promise.all([
            lookupTmdbByUpc(normalizedQuery),
            lookupOpenDbByUpc(normalizedQuery),
          ]);
          tmdbResults = tmdbDirect || [];
          openDbRecord = openDbDirect || null;
        } else {
          setStatusMsg('Checking Open Database...');
          openDbRecord = await lookupOpenDbByUpc(normalizedQuery);
        }

        if (openDbRecord) {
          preferredTitle = (openDbRecord.title || '').trim();
          preferredYear = safeYear(openDbRecord.year);
          detectedEdition = openDbRecord.edition || openDbRecord.title || '';

          if (keys.tmdb && preferredTitle && tmdbResults.length === 0) {
            setStatusMsg(`Found "${preferredTitle}". Matching TMDB...`);
            tmdbResults = await searchTmdbByTitleCandidates(
              buildTitleVariants(preferredTitle),
              preferredTitle,
              preferredYear
            );
          }
        }
      }

      if (!isBarcode) {
        preferredTitle = normalizedQuery;

        const openDbTitleCandidates = await lookupOpenDbByTitle(normalizedQuery);

        if (keys.tmdb) {
          setStatusMsg(`Searching title: "${normalizedQuery}"...`);
          const searchData = await fetchJsonWithRetry(
            `${TMDB_BASE_URL}/search/movie?api_key=${keys.tmdb}&query=${encodeURIComponent(normalizedQuery)}`,
            {},
            1,
            500,
            6500
          );
          tmdbResults = searchData?.results || [];
        }

        const rankedTmdb = rankTmdbResults(tmdbResults, preferredTitle, null);
        const merged = [...rankedTmdb, ...openDbTitleCandidates];

        if (merged.length > 0) {
          chooseCandidates(merged, detectedEdition);
          if (activeSearchRef.current === searchId) {
            setLookupCacheEntry(normalizedQuery, {
              candidates: merged,
              movieData: merged.length === 1 ? merged[0] : null,
              detectedEdition,
            });
          }
        } else {
          chooseCandidates([{
            id: null,
            title: normalizedQuery,
            release_date: '',
            overview: 'Manual title entry. TMDB match unavailable.',
            note: '',
            _source: 'manual-title',
            _score: 1,
          }], '');
        }

        return;
      }

      const ranked = Array.isArray(tmdbResults) && tmdbResults[0]?._score !== undefined
        ? tmdbResults
        : rankTmdbResults(tmdbResults, preferredTitle, preferredYear);

      if (ranked.length > 0) {
        setStatusMsg('Matches found.');
        chooseCandidates(ranked, detectedEdition);
        if (activeSearchRef.current === searchId) {
          setLookupCacheEntry(normalizedQuery, {
            candidates: ranked,
            movieData: ranked.length === 1 ? ranked[0] : null,
            detectedEdition,
          });
        }
      } else if (openDbRecord) {
        const fallback = {
          id: null,
          title: openDbRecord.title,
          release_date: openDbRecord.year ? `${openDbRecord.year}-01-01` : '',
          overview: 'Found in Open Database. TMDB details unavailable.',
          note: openDbRecord.edition || '',
          _source: openDbRecord.source,
          _score: 70,
        };
        chooseCandidates([fallback], detectedEdition);
        if (activeSearchRef.current === searchId) {
          setLookupCacheEntry(normalizedQuery, { candidates: [fallback], movieData: fallback, detectedEdition });
        }
      } else if (keys.tmdb) {
        setStatusMsg('Trying global UPC lookup...');
        let upcFallback = null;

        for (const upc of buildUpcCandidates(normalizedQuery)) {
          upcFallback = await lookupUpcItemDb(upc);
          if (upcFallback) break;
        }

        if (upcFallback) {
          detectedEdition = upcFallback.rawTitle;
          const fallbackRanked = await searchTmdbByTitleCandidates(
            upcFallback.titleCandidates || [upcFallback.cleanTitle],
            upcFallback.cleanTitle,
            null
          );

          if (fallbackRanked.length > 0) {
            setStatusMsg('Matches found via UPC lookup.');
            chooseCandidates(fallbackRanked, detectedEdition);
            if (activeSearchRef.current === searchId) {
              setLookupCacheEntry(normalizedQuery, {
                candidates: fallbackRanked,
                movieData: fallbackRanked.length === 1 ? fallbackRanked[0] : null,
                detectedEdition,
              });
            }
          } else {
            const fallbackManual = {
              id: null,
              title: upcFallback.cleanTitle,
              release_date: '',
              overview: 'Found by UPC lookup, but TMDB match is unavailable.',
              note: upcFallback.rawTitle,
              _source: 'upcitemdb',
              _score: 55,
            };
            chooseCandidates([fallbackManual], detectedEdition);
            if (activeSearchRef.current === searchId) {
              setLookupCacheEntry(normalizedQuery, { candidates: [fallbackManual], movieData: fallbackManual, detectedEdition });
            }
          }
        } else {
          setStatusMsg('Barcode not found. Try title search or manual entry.');
        }
      } else {
        setStatusMsg('Barcode not found. Try title search or manual entry.');
      }
    } catch (e) {
      console.error(e);
      setStatusMsg(`Lookup failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async (code) => {
    const normalized = normalizeScanOrInput(code);
    setScannedCode(normalized);
    if (normalized) searchTMDB(normalized);
  };

  return {
    loading,
    statusMsg,
    movieData,
    searchCandidates,
    scannedCode,
    userNote,
    setScannedCode,
    setUserNote,
    handleScan,
    searchTMDB,
    selectMovieCandidate,
    reset,
  };
}

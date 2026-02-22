import { useState, useEffect, useRef } from 'react'
import Scanner from './components/Scanner';
import MovieGrid from './components/MovieGrid';
import MovieDetail from './components/MovieDetail';
import { GitHubClient } from './utils/github';

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const OPEN_DB_BASE_URL = "https://raw.githubusercontent.com/Solfood/bluray-database/main";
const TITLE_NOISE_WORDS = new Set([
  '4k', 'uhd', 'ultra', 'hd', 'blu', 'ray', 'bluray', 'dvd', 'digital', 'code', 'edition',
  'steelbook', 'limited', 'collectors', 'collector', 'special', 'remastered', 'region', 'disc',
  'discs', 'video', 'arrow', 'criterion'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeTitle = (value) =>
  (value || "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const cleanProductTitle = (value) => {
  const text = (value || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[|/]/g, ' ')
    .replace(/\b(4k|uhd|ultra\s*hd|blu[\s-]?ray|dvd|digital\s*code|steelbook|limited\s*edition|collector'?s?\s*edition|arrow\s*video|criterion)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text || (value || '').trim();
};

const buildTitleVariants = (value) => {
  const raw = (value || '').trim();
  if (!raw) return [];

  const variants = new Set();
  variants.add(cleanProductTitle(raw));
  variants.add(raw.split(/[:\-|]/)[0].trim());
  variants.add(raw.split(/[\[(]/)[0].trim());

  const cleanedWords = cleanProductTitle(raw)
    .split(/\s+/)
    .filter((w) => w && !TITLE_NOISE_WORDS.has(w.toLowerCase()));
  if (cleanedWords.length) variants.add(cleanedWords.join(' '));

  return [...variants]
    .map((v) => v.replace(/\s+/g, ' ').trim())
    .filter((v) => v.length >= 2)
    .slice(0, 4);
};

const safeYear = (value) => {
  if (!value) return null;
  const y = String(value).slice(0, 4);
  return /^\d{4}$/.test(y) ? Number(y) : null;
};

const normalizeScanOrInput = (value) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 8 ? digits : trimmed;
};

const buildUpcCandidates = (rawUpc) => {
  const digits = (rawUpc || "").replace(/\D/g, "");
  if (!digits) return [];

  const variants = new Set([digits]);
  if (digits.length === 13 && digits.startsWith("0")) variants.add(digits.slice(1));
  if (digits.length === 12) variants.add(`0${digits}`);

  return [...variants];
};

const scoreMovieCandidate = (candidate, preferredTitle, preferredYear) => {
  let score = 0;
  const candTitle = normalizeTitle(candidate.title || "");
  const prefTitle = normalizeTitle(preferredTitle || "");

  if (candTitle && prefTitle) {
    if (candTitle === prefTitle) score += 100;
    else if (candTitle.includes(prefTitle) || prefTitle.includes(candTitle)) score += 65;

    const candWords = new Set(candTitle.split(" ").filter(Boolean));
    const prefWords = prefTitle.split(" ").filter(Boolean);
    const overlap = prefWords.filter((w) => candWords.has(w)).length;
    score += Math.min(overlap * 6, 30);
  }

  const candYear = safeYear(candidate.release_date);
  if (candYear && preferredYear) {
    const delta = Math.abs(candYear - preferredYear);
    if (delta === 0) score += 35;
    else if (delta === 1) score += 20;
    else if (delta <= 3) score += 8;
  }

  return score;
};

function App() {
  const [view, setView] = useState('home');
  const [keys, setKeys] = useState(() => {
    const saved = localStorage.getItem('bluray_keys');
    return saved ? JSON.parse(saved) : { tmdb: '', github: '' };
  });

  const [scannedCode, setScannedCode] = useState("");
  const [movieData, setMovieData] = useState(null);
  const [searchCandidates, setSearchCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [movies, setMovies] = useState([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [userNote, setUserNote] = useState("");

  const openDbIndexesRef = useRef({ loaded: false, upc: null, title: null });

  useEffect(() => {
    if (keys.github) {
      loadMovies();
    } else {
      loadPublicMovies();
    }
  }, [keys.github]);

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

  const loadPublicMovies = async () => {
    try {
      const res = await fetchWithTimeout('https://raw.githubusercontent.com/Solfood/bluray/main/movies.json', {}, 9000);
      if (res.ok) {
        const data = await res.json();
        setMovies(data.movies || []);
      }
    } catch (e) {
      console.error('Failed to load public movies', e);
    }
  };

  const saveKeys = (newKeys) => {
    setKeys(newKeys);
    localStorage.setItem('bluray_keys', JSON.stringify(newKeys));
    if (newKeys.github) loadMovies();
    setView('home');
  };

  const loadMovies = async () => {
    if (!keys.github) return;
    const client = new GitHubClient(keys.github);
    const data = await client.getMovies();
    setMovies(data.movies);
  };

  const loadOpenDbIndexes = async () => {
    if (openDbIndexesRef.current.loaded) return openDbIndexesRef.current;

    const [upcIndex, titleIndex] = await Promise.all([
      fetchJsonWithRetry(`${OPEN_DB_BASE_URL}/upc_index.json`, {}, 1, 500, 6000).catch(() => null),
      fetchJsonWithRetry(`${OPEN_DB_BASE_URL}/title_index.json`, {}, 1, 500, 6000).catch(() => null)
    ]);

    openDbIndexesRef.current = {
      loaded: true,
      upc: upcIndex?.index || upcIndex || null,
      title: titleIndex?.index || titleIndex || null
    };

    return openDbIndexesRef.current;
  };

  const lookupOpenDbByUpc = async (rawUpc) => {
    const upcVariants = buildUpcCandidates(rawUpc);
    if (upcVariants.length === 0) return null;

    const indexes = await loadOpenDbIndexes().catch(() => ({ upc: null }));
    if (indexes?.upc) {
      for (const upc of upcVariants) {
        if (indexes.upc[upc]) {
          return { ...indexes.upc[upc], upc, source: 'open-db-index' };
        }
      }
    }

    for (const upc of upcVariants) {
      if (upc.length < 3) continue;
      const chunkUrl = `${OPEN_DB_BASE_URL}/upc/${upc[0]}/${upc[1]}/${upc[2]}/${upc}.json`;
      try {
        const upcData = await fetchJsonWithRetry(chunkUrl, {}, 1, 400, 5500);
        if (upcData) return { ...upcData, upc, source: 'open-db-chunk' };
      } catch (e) {
        console.warn('Open DB chunk lookup failed', e);
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
      _score: 45
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

  const rankTmdbResults = (results, preferredTitle = '', preferredYear = null) => {
    const unique = [];
    const seen = new Set();

    for (const item of results || []) {
      const key = item.id ? `id:${item.id}` : `t:${normalizeTitle(item.title)}:${safeYear(item.release_date) || 'na'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    return unique
      .map((item) => ({ ...item, _score: scoreMovieCandidate(item, preferredTitle, preferredYear), _source: 'tmdb' }))
      .sort((a, b) => b._score - a._score);
  };

  const selectMovieCandidate = (candidate, detectedEdition = '') => {
    if (!candidate) return;
    const merged = {
      ...candidate,
      detected_edition: detectedEdition,
      note: candidate.note || detectedEdition || ''
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

  const handleScan = async (code) => {
    const normalized = normalizeScanOrInput(code);
    setScannedCode(normalized);
    setView('add');
    if (normalized) searchTMDB(normalized);
  };

  const searchTMDB = async (query) => {
    const normalizedQuery = normalizeScanOrInput(query);
    if (!normalizedQuery) {
      setStatusMsg('Enter a title or UPC.');
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

      if (isBarcode && keys.tmdb) {
        setStatusMsg(`Analyzing barcode: ${normalizedQuery}...`);

        for (const upc of buildUpcCandidates(normalizedQuery)) {
          try {
            const findData = await fetchJsonWithRetry(
              `${TMDB_BASE_URL}/find/${upc}?api_key=${keys.tmdb}&external_source=upc`,
              {},
              1,
              500,
              6000
            );
            if (findData?.movie_results?.length) {
              tmdbResults = findData.movie_results;
              break;
            }
          } catch (e) {
            console.warn('TMDB UPC find failed', e);
          }
        }
      }

      let openDbRecord = null;
      if (isBarcode && tmdbResults.length === 0) {
        setStatusMsg('Checking Open Database...');
        openDbRecord = await lookupOpenDbByUpc(normalizedQuery);

        if (openDbRecord) {
          preferredTitle = (openDbRecord.title || '').trim();
          preferredYear = safeYear(openDbRecord.year);
          detectedEdition = openDbRecord.edition || openDbRecord.title || '';

          if (keys.tmdb && preferredTitle) {
            setStatusMsg(`Found "${preferredTitle}". Matching TMDB...`);
            const rankedFromPreferred = await searchTmdbByTitleCandidates(
              buildTitleVariants(preferredTitle),
              preferredTitle,
              preferredYear
            );
            tmdbResults = rankedFromPreferred;
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
        } else {
          chooseCandidates([{
            id: null,
            title: normalizedQuery,
            release_date: '',
            overview: 'Manual title entry. TMDB match unavailable.',
            note: '',
            _source: 'manual-title',
            _score: 1
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
      } else if (openDbRecord) {
        const fallback = {
          id: null,
          title: openDbRecord.title,
          release_date: openDbRecord.year ? `${openDbRecord.year}-01-01` : '',
          overview: 'Found in Open Database. TMDB details unavailable.',
          note: openDbRecord.edition || '',
          _source: openDbRecord.source,
          _score: 70
        };
        chooseCandidates([fallback], detectedEdition);
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
          } else {
            chooseCandidates([{
              id: null,
              title: upcFallback.cleanTitle,
              release_date: '',
              overview: 'Found by UPC lookup, but TMDB match is unavailable.',
              note: upcFallback.rawTitle,
              _source: 'upcitemdb',
              _score: 55
            }], detectedEdition);
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

  const handleSaveMovie = async () => {
    if (!movieData || !keys.github) return;

    setLoading(true);
    try {
      const client = new GitHubClient(keys.github);
      const normalized = normalizeScanOrInput(scannedCode);
      const upcDigits = normalized.replace(/\D/g, '');
      const hasTmdbId = typeof movieData.id === 'number';

      const newMovie = {
        id: hasTmdbId ? movieData.id : `manual-${Date.now()}`,
        tmdb_id: hasTmdbId ? movieData.id : null,
        title: movieData.title,
        poster_path: movieData.poster_path || null,
        release_date: movieData.release_date || '',
        upc: upcDigits || normalized,
        added_at: new Date().toISOString(),
        note: userNote,
        status: hasTmdbId ? 'pending_enrichment' : 'needs_tmdb_match',
        match_source: movieData._source || 'manual',
        match_score: movieData._score || null
      };

      // Optimistic UI update so save feels instant in app even before GitHub round-trip completes.
      setMovies((prev) => {
        if (prev.some((m) => m.upc === newMovie.upc && m.title === newMovie.title)) return prev;
        return [...prev, newMovie];
      });
      setView('home');
      setMovieData(null);
      setSearchCandidates([]);
      setScannedCode('');
      setStatusMsg('');
      setLoading(false);

      await client.addMovie(newMovie);
      loadMovies();
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
      loadMovies();
    } finally {
      setLoading(false);
    }
  };

  if (view === 'settings' || (!keys.github && view !== 'home')) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center justify-center">
        <h2 className="text-3xl font-bold mb-8">Admin Setup</h2>
        <div className="w-full max-w-md space-y-6 bg-gray-800 p-6 rounded-2xl shadow-xl">
          <div>
            <label className="block text-sm text-gray-400 mb-2">GitHub Token</label>
            <input type="password" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500" value={keys.github} onChange={(e) => setKeys({ ...keys, github: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">TMDB API Key</label>
            <input type="password" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500" value={keys.tmdb} onChange={(e) => setKeys({ ...keys, tmdb: e.target.value })} />
          </div>
          <div className="flex gap-4 pt-4">
            <button onClick={() => setView('home')} className="flex-1 bg-gray-700 py-3 rounded-xl font-bold">Cancel</button>
            <button onClick={() => saveKeys(keys)} className="flex-1 bg-blue-600 py-3 rounded-xl font-bold shadow-lg shadow-blue-900/40">Save Access</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'scan') return <Scanner onScan={handleScan} onClose={() => setView('home')} />;

  if (view === 'add') {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => setView('home')} className="mb-6 text-gray-400 flex items-center gap-2 text-lg">
            <span className="text-2xl">&larr;</span> Back to Library
          </button>
          <h2 className="text-3xl font-bold mb-6">Add Movie</h2>

          <div className="flex gap-2 mb-8">
            <input
              className="flex-1 bg-gray-800 p-4 rounded-xl text-lg outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search Title or UPC..."
              value={scannedCode}
              onChange={(e) => setScannedCode(e.target.value)}
            />
            <button onClick={() => searchTMDB(scannedCode)} className="bg-blue-600 px-6 rounded-xl font-bold">Find</button>
          </div>

          {(loading || statusMsg) && (
            <div className={`text-center mb-6 p-5 rounded-2xl border ${loading ? 'bg-gray-800 border-blue-500/30' : 'bg-gray-800/50 border-gray-700'}`}>
              {loading && <div className="animate-spin text-4xl mb-3">💿</div>}
              <p className={`font-mono text-sm ${loading ? 'text-blue-400' : 'text-gray-400'}`}>{statusMsg}</p>
            </div>
          )}

          {searchCandidates.length > 1 && !movieData && (
            <div className="bg-gray-800/70 border border-gray-700 rounded-2xl p-4 mb-6">
              <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-3">Select the correct match</h3>
              <div className="space-y-2">
                {searchCandidates.map((candidate) => (
                  <button
                    key={`${candidate.id ?? candidate.title}-${candidate.release_date ?? ''}`}
                    onClick={() => selectMovieCandidate(candidate, userNote)}
                    className="w-full text-left p-3 rounded-lg bg-gray-900/60 hover:bg-gray-900 border border-gray-700 hover:border-blue-500 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{candidate.title}</p>
                        <p className="text-xs text-gray-400">{candidate.release_date?.split('-')[0] || 'Unknown year'} • score {candidate._score ?? 0}</p>
                      </div>
                      <span className="text-[10px] uppercase text-gray-500">{candidate._source || 'match'}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {movieData && !loading && (
            <div className="bg-gray-800 p-6 rounded-2xl shadow-2xl animate-fade-in">
              <div className="flex flex-col md:flex-row gap-6">
                {movieData.poster_path && (
                  <img src={`https://image.tmdb.org/t/p/w342${movieData.poster_path}`} alt="Poster" className="w-40 rounded-xl shadow-lg mx-auto md:mx-0" />
                )}
                <div className="flex-1 space-y-4">
                  <div>
                    <h3 className="text-2xl font-bold leading-tight">{movieData.title}</h3>
                    <p className="text-gray-400">{movieData.release_date?.split('-')[0] || 'Unknown year'}</p>
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Edition / Notes</label>
                    <input
                      value={userNote}
                      onChange={(e) => setUserNote(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 p-3 rounded-lg text-sm text-blue-300 focus:border-blue-500 outline-none"
                      placeholder="e.g. Steelbook, Criterion, Digital..."
                    />
                  </div>

                  <p className="text-sm text-gray-300 leading-relaxed">{movieData.overview || 'No summary available.'}</p>

                  <button
                    onClick={handleSaveMovie}
                    className="w-full bg-green-600 py-4 rounded-xl font-bold text-lg shadow-lg shadow-green-900/30 hover:scale-[1.02] transition-transform"
                  >
                    Add to Collection
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const filteredMovies = movies.filter((m) =>
    m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.note || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-safe">
      <header className="sticky top-0 z-20 bg-gray-900/90 backdrop-blur-md border-b border-gray-800 p-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              My Collection
            </h1>
            <div className="flex gap-4 md:hidden">
              <button onClick={() => setView('settings')} className="text-2xl">⚙️</button>
              {keys.github && <button onClick={() => setView('scan')} className="text-2xl">📷</button>}
            </div>
          </div>

          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              placeholder="Filter movies..."
              className="w-full bg-gray-800 text-white pl-10 pr-4 py-2 rounded-full border border-gray-700 focus:border-blue-500 outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="absolute left-3 top-2.5 text-gray-500">🔍</span>
          </div>

          <div className="hidden md:flex gap-4">
            <button onClick={() => setView('settings')} className="text-gray-400 hover:text-white">Settings</button>
            {keys.github && (
              <button
                onClick={() => setView('scan')}
                className="bg-blue-600 px-4 py-2 rounded-full font-bold hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
              >
                + Add Movie
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto mt-4">
        <MovieGrid
          movies={filteredMovies}
          loading={false}
          onMovieClick={setSelectedMovie}
        />
      </main>

      {keys.github && (
        <button
          onClick={() => setView('scan')}
          className="md:hidden fixed bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full shadow-2xl shadow-blue-600/40 flex items-center justify-center text-2xl z-40 active:scale-90 transition-transform"
        >
          📷
        </button>
      )}

      {selectedMovie && (
        <MovieDetail
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
        />
      )}
    </div>
  );
}

export default App

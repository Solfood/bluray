import { useState, useEffect, useRef } from 'react'
import Scanner from './components/Scanner';
import MovieGrid from './components/MovieGrid';
import MovieDetail from './components/MovieDetail';
import { GitHubClient } from './utils/github';
import { moviesMatch, normalizeScanOrInput, sortMoviesNewestFirst } from './utils/movies';
import { useLookup } from './hooks/useLookup';
import { loadSettingsFromGist, saveSettingsToGist } from './utils/gist';

function App() {
  const [view, setView] = useState('home');
  const [keys, setKeys] = useState(() => {
    const saved = localStorage.getItem('bluray_keys');
    return saved ? JSON.parse(saved) : { tmdb: '', github: '', anthropic: '' };
  });
  const [gistStatus, setGistStatus] = useState(null); // null | 'syncing' | 'synced' | 'error'
  const gistSyncedRef = useRef(false);

  const [movies, setMovies] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const {
    loading,
    statusMsg,
    movieData,
    searchCandidates,
    scannedCode,
    userNote,
    coverUsage,
    setScannedCode,
    setUserNote,
    handleScan,
    searchTMDB,
    identifyFromCover,
    selectMovieCandidate,
    reset: resetLookup,
  } = useLookup(keys);

  useEffect(() => {
    if (keys.github) {
      loadMovies();
      syncFromGist(keys.github);
    } else {
      loadPublicMovies();
    }
  }, [keys.github]);

  const syncFromGist = async (token) => {
    if (gistSyncedRef.current) return;
    gistSyncedRef.current = true;
    setGistStatus('syncing');
    try {
      const remote = await loadSettingsFromGist(token);
      if (remote) {
        setKeys((prev) => {
          const merged = {
            ...prev,
            tmdb: remote.tmdb || prev.tmdb,
            anthropic: remote.anthropic || prev.anthropic,
          };
          localStorage.setItem('bluray_keys', JSON.stringify(merged));
          return merged;
        });
      }
      setGistStatus('synced');
    } catch (e) {
      console.warn('Gist sync failed', e);
      setGistStatus('error');
    }
  };

  const pushToGist = async (token, { tmdb, anthropic }) => {
    try {
      await saveSettingsToGist(token, { tmdb, anthropic });
      setGistStatus('synced');
    } catch (e) {
      console.warn('Gist save failed', e);
      setGistStatus('error');
    }
  };

  const loadPublicMovies = async () => {
    try {
      const res = await fetch('https://raw.githubusercontent.com/Solfood/bluray/main/movies.json');
      if (res.ok) {
        const data = await res.json();
        setMovies(sortMoviesNewestFirst(data.movies || []));
      }
    } catch (e) {
      console.error('Failed to load public movies', e);
    }
  };

  const loadMovies = async () => {
    if (!keys.github) return;
    const client = new GitHubClient(keys.github);
    const data = await client.getMovies();
    setMovies(sortMoviesNewestFirst(data.movies));
  };

  const saveKeys = (newKeys) => {
    setKeys(newKeys);
    localStorage.setItem('bluray_keys', JSON.stringify(newKeys));
    if (newKeys.github) {
      loadMovies();
      pushToGist(newKeys.github, { tmdb: newKeys.tmdb, anthropic: newKeys.anthropic });
    }
    setView('home');
  };

  const handleSaveMovie = async () => {
    if (!movieData || !keys.github) return;

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
      overview: movieData.overview || '',
      upc: upcDigits || normalized,
      added_at: new Date().toISOString(),
      note: userNote,
      status: hasTmdbId ? 'pending_enrichment' : 'needs_tmdb_match',
      match_source: movieData._source || 'manual',
      match_score: movieData._score || null,
    };

    // Optimistic update so the save feels instant before the GitHub round-trip.
    setMovies((prev) => {
      if (prev.some((m) => moviesMatch(m, newMovie))) return prev;
      return sortMoviesNewestFirst([newMovie, ...prev]);
    });
    setView('home');
    resetLookup();

    try {
      await client.addMovie(newMovie);
      loadMovies();
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
      loadMovies();
    }
  };

  const handleDeleteMovie = async (movieToDelete) => {
    if (!movieToDelete || !keys.github) return;
    const confirmed = window.confirm(`Delete "${movieToDelete.title}" from your collection?`);
    if (!confirmed) return;

    const previous = [...movies];
    setSelectedMovie(null);
    setMovies((prev) => prev.filter((m) => !moviesMatch(m, movieToDelete)));

    try {
      const client = new GitHubClient(keys.github);
      await client.deleteMovie(movieToDelete);
      loadMovies();
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
      setMovies(previous);
    }
  };

  const handleBackToLibrary = () => {
    setView('home');
    resetLookup();
  };

  const syncStatusLabel = () => {
    if (gistStatus === 'syncing') return '↻ Syncing…';
    if (gistStatus === 'synced') return '✓ Synced to GitHub';
    if (gistStatus === 'error') return '⚠ Sync failed';
    return null;
  };

  if (view === 'settings' || (!keys.github && view !== 'home')) {
    const statusLabel = syncStatusLabel();
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
          <div>
            <label className="block text-sm text-gray-400 mb-2">Anthropic API Key <span className="text-gray-600">(cover photo ID)</span></label>
            <input type="password" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500" value={keys.anthropic || ''} onChange={(e) => setKeys({ ...keys, anthropic: e.target.value })} />
          </div>

          {statusLabel && (
            <p className={`text-xs text-center ${gistStatus === 'error' ? 'text-yellow-500' : 'text-gray-500'}`}>
              {statusLabel}
              {gistStatus === 'error' && keys.github && (
                <button
                  onClick={() => {
                    gistSyncedRef.current = false;
                    syncFromGist(keys.github);
                  }}
                  className="ml-2 underline text-blue-400"
                >
                  Retry
                </button>
              )}
            </p>
          )}

          <div className="flex gap-4 pt-2">
            <button onClick={() => setView('home')} className="flex-1 bg-gray-700 py-3 rounded-xl font-bold">Cancel</button>
            <button onClick={() => saveKeys(keys)} className="flex-1 bg-blue-600 py-3 rounded-xl font-bold shadow-lg shadow-blue-900/40">Save Access</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'scan') {
    return (
      <Scanner
        onScan={(code) => { setView('add'); handleScan(code); }}
        onCoverPhoto={(file) => { setView('add'); identifyFromCover(file); }}
        canUseCover={Boolean(keys.anthropic)}
        coverUsage={coverUsage}
        onClose={() => setView('home')}
      />
    );
  }

  if (view === 'add') {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          <button onClick={handleBackToLibrary} className="mb-6 text-gray-400 flex items-center gap-2 text-lg">
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
          onDelete={handleDeleteMovie}
          canDelete={Boolean(keys.github)}
        />
      )}
    </div>
  );
}

export default App

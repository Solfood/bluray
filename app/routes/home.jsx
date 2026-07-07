import { useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';
import Scanner from '../components/Scanner';
import MovieGrid from '../components/MovieGrid';
import MovieDetail from '../components/MovieDetail';
import { useServerLookup } from '../hooks/useServerLookup';
import { getDb } from '../../server/db/index';
import { listMovies, searchMovies, rowToApi, getMeta } from '../../server/db/movies';
import { getMonthlyUsage } from '../../server/services/identify';
import { startScheduler } from '../../server/scheduler';

export function loader({ request }) {
  startScheduler();
  const db = getDb();
  const q = new URL(request.url).searchParams.get('q')?.trim() || '';
  const rows = q ? searchMovies(db, q) : listMovies(db);
  return {
    movies: rows.map(rowToApi),
    q,
    config: {
      canUseCover: Boolean(process.env.ANTHROPIC_API_KEY),
      coverUsage: getMonthlyUsage(db),
      lastBackupAt: getMeta(db, 'last_backup_at'),
      lastBackupOk: getMeta(db, 'last_backup_ok') !== 'false',
    },
  };
}

async function apiFetch(url, options) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function Home() {
  const { movies, q, config } = useLoaderData();
  const revalidator = useRevalidator();

  const [view, setView] = useState('home');
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [searchTerm, setSearchTerm] = useState(q);
  const [activeGenre, setActiveGenre] = useState(null);

  const {
    loading, statusMsg, movieData, searchCandidates, scannedCode, userNote,
    setScannedCode, setUserNote, handleScan, search, identifyFromCover,
    selectMovieCandidate, reset: resetLookup,
  } = useServerLookup();

  const handleSaveMovie = async () => {
    if (!movieData) return;
    const hasTmdbId = typeof movieData.id === 'number';
    try {
      await apiFetch('/api/movies', {
        method: 'POST',
        body: JSON.stringify({
          tmdb_id: hasTmdbId ? movieData.id : null,
          title: movieData.title,
          poster_path: movieData.poster_path || undefined,
          release_date: movieData.release_date || undefined,
          overview: movieData.overview || undefined,
          upc: scannedCode || undefined,
          note: userNote,
          match_source: movieData._source || 'manual',
          match_score: movieData._score ?? undefined,
        }),
      });
      setView('home');
      resetLookup();
      revalidator.revalidate();
      // Enrichment lands seconds later; refresh once more to pick it up.
      setTimeout(() => revalidator.revalidate(), 4000);
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    }
  };

  const handleDeleteMovie = async (movie) => {
    if (!window.confirm(`Delete "${movie.title}" from your collection?`)) return;
    setSelectedMovie(null);
    try {
      await apiFetch(`/api/movies/${movie.pk}`, { method: 'DELETE' });
      revalidator.revalidate();
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
    }
  };

  const handleUpdateMovie = async (movie, fields) => {
    try {
      const updated = await apiFetch(`/api/movies/${movie.pk}`, { method: 'PATCH', body: JSON.stringify(fields) });
      setSelectedMovie(updated);
      revalidator.revalidate();
    } catch (e) {
      alert(`Failed to update: ${e.message}`);
    }
  };

  const handleRetryEnrich = async (movie) => {
    try {
      const updated = await apiFetch(`/api/movies/${movie.pk}/enrich`, { method: 'POST' });
      setSelectedMovie(updated);
      revalidator.revalidate();
    } catch (e) {
      alert(`Failed to enrich: ${e.message}`);
    }
  };

  const handleBackToLibrary = () => {
    setView('home');
    resetLookup();
  };

  if (view === 'scan') {
    return (
      <Scanner
        onScan={(code) => { setView('add'); handleScan(code); }}
        onCoverPhoto={(file) => { setView('add'); identifyFromCover(file); }}
        canUseCover={config.canUseCover}
        coverUsage={config.coverUsage}
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
            <button onClick={() => search(scannedCode)} className="bg-blue-600 px-6 rounded-xl font-bold">Find</button>
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

  const allGenres = [...new Set(movies.flatMap((m) => m.genres || []))].sort();

  const filteredMovies = movies.filter((m) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      m.title.toLowerCase().includes(term) ||
      (m.note || '').toLowerCase().includes(term) ||
      (m.overview || '').toLowerCase().includes(term);
    const matchesGenre = !activeGenre || (m.genres || []).includes(activeGenre);
    return matchesSearch && matchesGenre;
  });

  const backupLabel = () => {
    if (!config.lastBackupAt) return 'Backup: never run';
    const days = Math.floor((Date.now() - Date.parse(config.lastBackupAt)) / 86400000);
    const when = days === 0 ? 'today' : `${days}d ago`;
    return config.lastBackupOk ? `Backup: ✓ ${when}` : `Backup: ⚠ failed (last success ${when})`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-safe">
      <header className="sticky top-0 z-20 bg-gray-900/90 backdrop-blur-md border-b border-gray-800 p-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              My Collection
            </h1>
            <div className="flex gap-4 md:hidden">
              <button onClick={() => setView('scan')} className="text-2xl">📷</button>
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
            <button
              onClick={() => setView('scan')}
              className="bg-blue-600 px-4 py-2 rounded-full font-bold hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
            >
              + Add Movie
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto mt-4">
        {allGenres.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            <button
              onClick={() => setActiveGenre(null)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${!activeGenre ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-600 text-gray-400 hover:text-white hover:border-gray-400'}`}
            >
              All
            </button>
            {allGenres.map((g) => (
              <button
                key={g}
                onClick={() => setActiveGenre(activeGenre === g ? null : g)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${activeGenre === g ? 'bg-purple-700 border-purple-700 text-white' : 'border-gray-600 text-gray-400 hover:text-white hover:border-gray-400'}`}
              >
                {g}
              </button>
            ))}
          </div>
        )}
        <MovieGrid movies={filteredMovies} loading={false} onMovieClick={setSelectedMovie} />
      </main>

      <footer className="text-center text-xs text-gray-600 py-4">{backupLabel()}</footer>

      <button
        onClick={() => setView('scan')}
        className="md:hidden fixed bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full shadow-2xl shadow-blue-600/40 flex items-center justify-center text-2xl z-40 active:scale-90 transition-transform"
      >
        📷
      </button>

      {selectedMovie && (
        <MovieDetail
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          onDelete={handleDeleteMovie}
          onUpdate={handleUpdateMovie}
          onRetryEnrich={handleRetryEnrich}
        />
      )}
    </div>
  );
}

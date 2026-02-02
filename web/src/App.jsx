import { useState, useEffect } from 'react'
import Scanner from './components/Scanner';
import { GitHubClient } from './utils/github';

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function App() {
  const [view, setView] = useState('home'); // home, scan, add, settings
  const [keys, setKeys] = useState(() => {
    const saved = localStorage.getItem('bluray_keys');
    return saved ? JSON.parse(saved) : { tmdb: '', github: '' };
  });
  const [scannedCode, setScannedCode] = useState(null);
  const [movieData, setMovieData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [movies, setMovies] = useState([]);

  // Load movies on mount
  useEffect(() => {
    if (keys.github) {
      loadMovies();
    }
  }, [keys.github]);

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

  const handleScan = async (code) => {
    setScannedCode(code);
    setView('add');
    // Auto-search if we have a key
    if (keys.tmdb) {
      searchTMDB(code);
    }
  };

  const searchTMDB = async (query) => {
    setLoading(true);
    try {
      // 1. Try to search by UPC if it looks like one (numbers only)
      // Note: TMDB doesn't have a direct "search by UPC" public endpoint easily without finding specific IDs, 
      // but we can try /search/movie with the code or title.
      // Usually UPC search needs a different DB, but let's assume query is a Title for now if logic is manual,
      // OR we use a UPC API.
      // For this MVP, let's search by Query (Title) or if it's a UPC using a specialized endpoint or external service?
      // Actually TMDB supports looking up by external ID (find endpoint)

      let url;
      if (/^\d+$/.test(query)) {
        // It's a barcode? Try find endpoint
        // But find requires "external_source", usually imdb_id. freebase_id etc.
        // UPC is tricky.
        // Let's rely on User typing title if UPC fails or prompt user.
        // For now, let's just assume query is a string.
        console.warn("UPC lookup in TMDB is limited. User might need to type title.");
      }

      const res = await fetch(`${TMDB_BASE_URL}/search/movie?api_key=${keys.tmdb}&query=${query}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        setMovieData(data.results[0]);
      } else {
        alert("No results found. Please enter title manually.");
      }
    } catch (e) {
      console.error(e);
      alert("Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMovie = async () => {
    if (!movieData || !keys.github) return;
    setLoading(true);
    try {
      const client = new GitHubClient(keys.github);
      // Shape the data
      const newMovie = {
        id: movieData.id,
        title: movieData.title,
        poster_path: movieData.poster_path,
        release_date: movieData.release_date,
        upc: scannedCode,
        added_at: new Date().toISOString(),
        status: 'pending_enrichment' // Trigger for the python script
      };

      await client.addMovie(newMovie);
      alert("Movie saved!");
      setView('home');
      loadMovies();
    } catch (e) {
      alert("Failed to save: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  if (view === 'settings' || !keys.github) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center">
        <h2 className="text-2xl mb-4">Settings</h2>
        <div className="w-full max-w-md space-y-4">
          <div>
            <label className="block text-sm text-gray-400">GitHub Token (Repo Scope)</label>
            <input
              type="password"
              className="w-full bg-gray-800 p-2 rounded text-white"
              value={keys.github}
              onChange={e => setKeys({ ...keys, github: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400">TMDB API Key</label>
            <input
              type="password"
              className="w-full bg-gray-800 p-2 rounded text-white"
              value={keys.tmdb}
              onChange={e => setKeys({ ...keys, tmdb: e.target.value })}
            />
          </div>
          <button
            onClick={() => saveKeys(keys)}
            className="w-full bg-blue-600 p-2 rounded hover:bg-blue-500"
          >
            Save & Continue
          </button>
        </div>
      </div>
    )
  }

  if (view === 'scan') {
    return <Scanner onScan={handleScan} onClose={() => setView('home')} />
  }

  if (view === 'add') {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <button onClick={() => setView('home')} className="mb-4 text-gray-400">&larr; Back</button>
        <h2 className="text-2xl mb-4">Add Movie</h2>

        <div className="flex gap-2 mb-4">
          <input
            className="flex-1 bg-gray-800 p-2 rounded"
            placeholder="Search Title..."
            defaultValue={scannedCode}
            onChange={(e) => setScannedCode(e.target.value)}
          />
          <button
            onClick={() => searchTMDB(scannedCode)}
            className="bg-blue-600 px-4 rounded"
          >
            Search
          </button>
        </div>

        {loading && <div className="text-center">Loading...</div>}

        {movieData && (
          <div className="bg-gray-800 p-4 rounded-xl flex gap-4">
            {movieData.poster_path && (
              <img
                src={`https://image.tmdb.org/t/p/w200${movieData.poster_path}`}
                alt="Poster"
                className="w-32 rounded-lg"
              />
            )}
            <div>
              <h3 className="text-xl font-bold">{movieData.title}</h3>
              <p className="text-gray-400">{movieData.release_date}</p>
              <p className="mt-2 text-sm text-gray-300 line-clamp-3">{movieData.overview}</p>
              <button
                onClick={handleSaveMovie}
                className="mt-4 bg-green-600 px-6 py-2 rounded hover:bg-green-500 w-full"
              >
                Save to Collection
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            My Collection
          </h1>
          <p className="text-gray-400 text-sm">{movies.length} Movies</p>
        </div>
        <button onClick={() => setView('settings')} className="text-gray-400 hover:text-white">⚙️</button>
      </header>

      <main>
        {/* Floating Action Button for Scan */}
        <div className="mb-8">
          <button
            onClick={() => setView('scan')}
            className="w-full py-4 border-2 border-dashed border-gray-700 rounded-xl flex items-center justify-center text-gray-500 hover:border-blue-500/50 hover:text-blue-400 transition-colors gap-2"
          >
            <span>📷 Scan Barcode / Add Movie</span>
          </button>
        </div>

        {/* Movie Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {movies.map((m, idx) => (
            <div key={idx} className="bg-gray-800 rounded-lg overflow-hidden group relative">
              {/* Status Indicator */}
              {m.status === 'pending_enrichment' && (
                <div className="absolute top-2 right-2 w-3 h-3 bg-yellow-500 rounded-full animate-pulse" title="Enriching..." />
              )}
              <img
                src={`https://image.tmdb.org/t/p/w200${m.poster_path}`}
                className="w-full aspect-[2/3] object-cover"
                loading="lazy"
              />
              <div className="p-2">
                <h4 className="font-bold truncate">{m.title}</h4>
                <p className="text-xs text-gray-500">{m.release_date?.split('-')[0]}</p>
              </div>
            </div>
          ))}
          {movies.length === 0 && (
            <p className="text-center col-span-full text-gray-500">No movies yet. Start scanning!</p>
          )}
        </div>
      </main>
    </div>
  )
}

export default App

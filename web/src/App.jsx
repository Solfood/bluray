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
  // Load movies on mount (even if no keys, we might want to fetch public JSON in future? 
  // For now, if no keys, we can't fetch from private repo easily without a proxy or if repo is public. 
  // Since repo is PUBLIC, we can fetch movies.json via raw.githubusercontent.com for read-only access!)
  useEffect(() => {
    // If we have keys, use API. If not, try public fetch.
    if (keys.github) {
      loadMovies();
    } else {
      loadPublicMovies();
    }
  }, [keys.github]);

  const loadPublicMovies = async () => {
    try {
      // Fetch raw content from the public repo
      const res = await fetch(`https://raw.githubusercontent.com/Solfood/bluray/main/movies.json`);
      if (res.ok) {
        const data = await res.json();
        setMovies(data.movies || []);
      }
    } catch (e) {
      console.error("Failed to load public movies", e);
    }
  };

  const saveKeys = (newKeys) => {
    setKeys(newKeys);
    localStorage.setItem('bluray_keys', JSON.stringify(newKeys));
    if (newKeys.github) loadMovies();
    setView('home');
  };

  // ... (rest of functions same) ...

  // RENDER LOGIC CHANGES below

  // If view is explicitly settings, show settings
  if (view === 'settings') {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center">
        {/* Settings UI same as before */}
        <h2 className="text-2xl mb-4">Settings</h2>
        <div className="w-full max-w-md space-y-4">
          <p className="text-sm text-gray-500 mb-4">Enter keys to enable adding movies. Visitors only see the gallery.</p>
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
          <div className="flex gap-2">
            <button
              onClick={() => setView('home')}
              className="flex-1 bg-gray-700 p-2 rounded hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={() => saveKeys(keys)}
              className="flex-1 bg-blue-600 p-2 rounded hover:bg-blue-500"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Implicit "Settings required" check removed. We allow Home view without keys.

  if (view === 'scan') {
    return <Scanner onScan={handleScan} onClose={() => setView('home')} />
  }

  // ... (Add view same) ...

  // HOME VIEW
  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            My Collection
          </h1>
          <p className="text-gray-400 text-sm">{movies.length} Movies</p>
        </div>
        <button onClick={() => setView('settings')} className="text-gray-400 hover:text-white" title="Admin Settings">⚙️</button>
      </header>

      <main>
        {/* Only show Add button if logged in (keys present) */}
        {keys.github && (
          <div className="mb-8">
            <button
              onClick={() => setView('scan')}
              className="w-full py-4 border-2 border-dashed border-gray-700 rounded-xl flex items-center justify-center text-gray-500 hover:border-blue-500/50 hover:text-blue-400 transition-colors gap-2"
            >
              <span>📷 Scan Barcode / Add Movie</span>
            </button>
          </div>
        )}

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

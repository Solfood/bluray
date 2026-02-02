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
  const [statusMsg, setStatusMsg] = useState("");

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
    setStatusMsg("Searching...");
    let detectedEdition = ""; // Capture edition info from UPC

    try {
      let data = { results: [] };

      // Check if query is likely a barcode (all digits, 10-13 chars)
      const isBarcode = /^\d{10,14}$/.test(query);

      if (isBarcode) {
        setStatusMsg(`Analyzing Barcode: ${query}...`);

        // 1. Try TMDB /find first (fastest, cleanest if it works)
        try {
          setStatusMsg("Checking TMDB Database...");
          let res = await fetch(`${TMDB_BASE_URL}/find/${query}?api_key=${keys.tmdb}&external_source=upc`);
          let findData = await res.json();
          if (findData.movie_results?.length > 0) {
            data.results = findData.movie_results;
          }
        } catch (e) { console.warn("TMDB UPC Find failed", e); }

        if (!data.results || data.results.length === 0) {
          try {
            setStatusMsg("Checking Global Barcode Database...");
            const proxyUrl = `https://corsproxy.io/?` + encodeURIComponent(`https://api.upcitemdb.com/prod/trial/lookup?upc=${query}`);
            const upcRes = await fetch(proxyUrl);

            if (!upcRes.ok) throw new Error(`UPC API Status: ${upcRes.status}`);

            const upcData = await upcRes.json();

            if (upcData.items && upcData.items.length > 0) {
              let rawTitle = upcData.items[0].title;
              detectedEdition = rawTitle;
              const cleanTitle = rawTitle.split(/[\[\(]/)[0].trim();
              setStatusMsg(`Found: "${cleanTitle}". Searching info...`);
              const searchRes = await fetch(`${TMDB_BASE_URL}/search/movie?api_key=${keys.tmdb}&query=${encodeURIComponent(cleanTitle)}`);
              if (!searchRes.ok) throw new Error(`TMDB Search Error: ${searchRes.status}`);
              const searchData = await searchRes.json();
              if (searchData.results?.length > 0) {
                data.results = searchData.results;
              }
            } else {
              console.warn("UPC API returned no items", upcData);
              setStatusMsg(`UPC DB returned 0 results for ${query}.`);
              // Pause briefly so user sees the message
              await new Promise(r => setTimeout(r, 2000));
            }
          } catch (err) {
            console.warn("UPCItemDB failed", err);
            setStatusMsg(`UPC Lookup Failed: ${err.message}`);
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }

      if (!isBarcode && (!data.results || data.results.length === 0)) {
        setStatusMsg(`Searching title: "${query}"...`);
        const res = await fetch(`${TMDB_BASE_URL}/search/movie?api_key=${keys.tmdb}&query=${encodeURIComponent(query)}`);

        if (!res.ok) throw new Error(`TMDB Error: ${res.status}`);
        data = await res.json();
      }

      // Check for strict API errors (like Invalid Key) even if 200 OK (TMDB sometimes does this)
      if (data.status_message) {
        throw new Error(data.status_message);
      }

      if (data.results && data.results.length > 0) {
        setStatusMsg("Movie Found!");
        setMovieData({ ...data.results[0], detected_edition: detectedEdition });
      } else {
        if (isBarcode) {
          setStatusMsg("Barcode not found. Type title?");
          setScannedCode(query);
        } else {
          setStatusMsg("No movie found with that name.");
        }
      }
    } catch (e) {
      console.error(e);
      // Make the error visible to user
      setStatusMsg("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMovie = async () => {
    if (!movieData || !keys.github) return;
    setLoading(true);
    try {
      const client = new GitHubClient(keys.github);
      const newMovie = {
        id: movieData.id,
        title: movieData.title,
        poster_path: movieData.poster_path,
        release_date: movieData.release_date,
        upc: scannedCode,
        added_at: new Date().toISOString(),
        note: movieData.detected_edition || "",
        status: 'pending_enrichment'
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

  if (view === 'settings') {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center">
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
            <button onClick={() => setView('home')} className="flex-1 bg-gray-700 p-2 rounded hover:bg-gray-600">Cancel</button>
            <button onClick={() => saveKeys(keys)} className="flex-1 bg-blue-600 p-2 rounded hover:bg-blue-500">Save</button>
          </div>
        </div>
      </div>
    );
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

        {(loading || statusMsg) && (
          <div className={`text-center my-8 p-4 rounded-xl border ${loading ? 'bg-gray-800 border-blue-500/30' : 'bg-gray-800 border-yellow-500/30'}`}>
            {loading && <div className="animate-spin text-4xl mb-4">💿</div>}
            <p className={`${loading ? 'text-blue-400' : 'text-yellow-400'} font-mono`}>{statusMsg}</p>
          </div>
        )}

        {movieData && !loading && (
          <div className="bg-gray-800 p-4 rounded-xl flex flex-col md:flex-row gap-4 animate-fade-in">
            {movieData.poster_path && (
              <img src={`https://image.tmdb.org/t/p/w200${movieData.poster_path}`} alt="Poster" className="w-32 rounded-lg mx-auto md:mx-0" />
            )}
            <div className="flex-1">
              <h3 className="text-xl font-bold">{movieData.title}</h3>
              {movieData.detected_edition && (
                <span className="inline-block bg-purple-900 text-purple-200 text-xs px-2 py-1 rounded mb-2 border border-purple-500/50">
                  Detected: {movieData.detected_edition}
                </span>
              )}
              <p className="text-gray-400">{movieData.release_date}</p>
              <p className="mt-2 text-sm text-gray-300 line-clamp-3">{movieData.overview}</p>
              <button
                onClick={handleSaveMovie}
                className="mt-4 bg-green-600 px-6 py-3 rounded hover:bg-green-500 w-full font-bold shadow-lg shadow-green-900/20"
              >
                Save to Collection
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

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
          {loading && (
            <div className="text-center my-4 col-span-full">
              <div className="animate-spin text-4xl mb-2">💿</div>
              <p className="text-blue-400 font-mono text-sm">{statusMsg}</p>
            </div>
          )}
          {movies.length === 0 && !loading && (
            <p className="text-center col-span-full text-gray-500">No movies yet. Start scanning!</p>
          )}
        </div>
      </main>
    </div>
  )
}

export default App

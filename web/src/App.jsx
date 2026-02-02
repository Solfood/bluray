import { useState, useEffect } from 'react'
import Scanner from './components/Scanner';
import MovieGrid from './components/MovieGrid';
import MovieDetail from './components/MovieDetail';
import { GitHubClient } from './utils/github';

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function App() {
  const [view, setView] = useState('home'); // home, scan, add, settings
  const [keys, setKeys] = useState(() => {
    const saved = localStorage.getItem('bluray_keys');
    return saved ? JSON.parse(saved) : { tmdb: '', github: '' };
  });

  // State
  const [scannedCode, setScannedCode] = useState(null);
  const [movieData, setMovieData] = useState(null); // The movie pending addition
  const [loading, setLoading] = useState(false);
  const [movies, setMovies] = useState([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [selectedMovie, setSelectedMovie] = useState(null); // Detailed view
  const [searchTerm, setSearchTerm] = useState(""); // Local filtering

  // "Edition" note state for the Add Screen
  // We initialize this when movieData is set
  const [userNote, setUserNote] = useState("");

  // Load movies on mount
  useEffect(() => {
    if (keys.github) {
      loadMovies();
    } else {
      loadPublicMovies();
    }
  }, [keys.github]);

  const loadPublicMovies = async () => {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/Solfood/bluray/main/movies.json`);
      if (res.ok) {
        const data = await res.json();
        setMovies(data.movies || []);
      }
    } catch (e) { console.error("Failed to load public movies", e); }
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
    if (keys.tmdb) searchTMDB(code);
  };

  const searchTMDB = async (query) => {
    setLoading(true);
    setStatusMsg("Searching...");
    let detectedEdition = "";

    try {
      let data = { results: [] };
      const isBarcode = /^\d{10,14}$/.test(query);

      if (isBarcode) {
        setStatusMsg(`Analyzing Barcode: ${query}...`);

        // 1. TMDB Find
        try {
          const res = await fetch(`${TMDB_BASE_URL}/find/${query}?api_key=${keys.tmdb}&external_source=upc`);
          const findData = await res.json();
          if (findData.movie_results?.length > 0) data.results = findData.movie_results;
        } catch (e) { console.warn("TMDB UPC Find failed", e); }

        // 2. AllOrigins Proxy -> UPCItemDB
        if (!data.results || data.results.length === 0) {
          try {
            setStatusMsg("Checking Global Barcode Database...");
            const proxyUrl = `https://api.allorigins.win/raw?url=` + encodeURIComponent(`https://api.upcitemdb.com/prod/trial/lookup?upc=${query}`);
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
              if (searchData.results?.length > 0) data.results = searchData.results;
            } else {
              setStatusMsg(`UPC DB returned 0 results.`);
              await new Promise(r => setTimeout(r, 1500));
            }
          } catch (err) {
            console.warn("UPCItemDB failed", err);
            setStatusMsg(`UPC Lookup Failed: ${err.message}`);
            await new Promise(r => setTimeout(r, 1500));
          }
        }
      }

      if (!isBarcode && (!data.results || data.results.length === 0)) {
        setStatusMsg(`Searching title: "${query}"...`);
        const res = await fetch(`${TMDB_BASE_URL}/search/movie?api_key=${keys.tmdb}&query=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error(`TMDB Error: ${res.status}`);
        data = await res.json();
      }

      if (data.status_message) throw new Error(data.status_message);

      if (data.results && data.results.length > 0) {
        setStatusMsg("Movie Found!");
        setMovieData({ ...data.results[0], detected_edition: detectedEdition });
        setUserNote(detectedEdition); // Pre-fill the editable note!
      } else {
        setStatusMsg(isBarcode ? "Barcode not found. Type title?" : "No movie found.");
      }
    } catch (e) {
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
        note: userNote, // SAVE THE EDITED NOTE
        status: 'pending_enrichment'
      };

      await client.addMovie(newMovie);
      setView('home');
      loadMovies();
      setMovieData(null);
      setScannedCode("");
    } catch (e) {
      alert("Failed to save: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Views ---

  if (view === 'settings' || (!keys.github && view !== 'home')) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center justify-center">
        <h2 className="text-3xl font-bold mb-8">Admin Setup</h2>
        <div className="w-full max-w-md space-y-6 bg-gray-800 p-6 rounded-2xl shadow-xl">
          <div>
            <label className="block text-sm text-gray-400 mb-2">GitHub Token</label>
            <input type="password" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500" value={keys.github} onChange={e => setKeys({ ...keys, github: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">TMDB API Key</label>
            <input type="password" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500" value={keys.tmdb} onChange={e => setKeys({ ...keys, tmdb: e.target.value })} />
          </div>
          <div className="flex gap-4 pt-4">
            <button onClick={() => setView('home')} className="flex-1 bg-gray-700 py-3 rounded-xl font-bold">Cancel</button>
            <button onClick={() => saveKeys(keys)} className="flex-1 bg-blue-600 py-3 rounded-xl font-bold shadow-lg shadow-blue-900/40">Save Access</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'scan') return <Scanner onScan={handleScan} onClose={() => setView('home')} />

  if (view === 'add') {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => setView('home')} className="mb-6 text-gray-400 flex items-center gap-2 text-lg">
            <span className="text-2xl">&larr;</span> Back to Library
          </button>
          <h2 className="text-3xl font-bold mb-6">Add Movie</h2>

          {/* Search Box */}
          <div className="flex gap-2 mb-8">
            <input
              className="flex-1 bg-gray-800 p-4 rounded-xl text-lg outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search Title or UPC..."
              defaultValue={scannedCode}
              onChange={(e) => setScannedCode(e.target.value)}
            />
            <button onClick={() => searchTMDB(scannedCode)} className="bg-blue-600 px-6 rounded-xl font-bold">Find</button>
          </div>

          {/* Status Log */}
          {(loading || statusMsg) && (
            <div className={`text-center mb-8 p-6 rounded-2xl border ${loading ? 'bg-gray-800 border-blue-500/30' : 'bg-gray-800/50 border-gray-700'}`}>
              {loading && <div className="animate-spin text-4xl mb-4">💿</div>}
              <p className={`font-mono text-sm ${loading ? 'text-blue-400' : 'text-gray-400'}`}>{statusMsg}</p>
            </div>
          )}

          {/* Result Card */}
          {movieData && !loading && (
            <div className="bg-gray-800 p-6 rounded-2xl shadow-2xl animate-fade-in">
              <div className="flex flex-col md:flex-row gap-6">
                {movieData.poster_path && (
                  <img src={`https://image.tmdb.org/t/p/w342${movieData.poster_path}`} alt="Poster" className="w-40 rounded-xl shadow-lg mx-auto md:mx-0" />
                )}
                <div className="flex-1 space-y-4">
                  <div>
                    <h3 className="text-2xl font-bold leading-tight">{movieData.title}</h3>
                    <p className="text-gray-400">{movieData.release_date?.split('-')[0]}</p>
                  </div>

                  {/* Editable Note Field */}
                  <div>
                    <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Edition / Notes</label>
                    <input
                      value={userNote}
                      onChange={(e) => setUserNote(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 p-3 rounded-lg text-sm text-blue-300 focus:border-blue-500 outline-none"
                      placeholder="e.g. Steelbook, Criterion, Digital..."
                    />
                  </div>

                  <p className="text-sm text-gray-300 line-clamp-3 leading-relaxed">{movieData.overview}</p>

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
    )
  }

  // --- Home View (Grid) ---

  // Filter movies
  const filteredMovies = movies.filter(m =>
    m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.note || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-safe">
      {/* Sticky Header */}
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

          {/* Search Bar */}
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

      {/* Floating Action Button (Mobile Only) */}
      {keys.github && (
        <button
          onClick={() => setView('scan')}
          className="md:hidden fixed bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full shadow-2xl shadow-blue-600/40 flex items-center justify-center text-2xl z-40 active:scale-90 transition-transform"
        >
          📷
        </button>
      )}

      {/* Detail Modal */}
      {selectedMovie && (
        <MovieDetail
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
        />
      )}
    </div>
  )
}

export default App

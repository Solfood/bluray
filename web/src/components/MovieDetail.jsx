import React, { useEffect } from 'react';

function formatRuntime(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function MovieDetail({ movie, onClose, onDelete, canDelete = false }) {
    if (!movie) return null;

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    const runtime = formatRuntime(movie.runtime);
    const genres = Array.isArray(movie.genres) && movie.genres.length > 0 ? movie.genres : null;
    const audioTracks = Array.isArray(movie.audio_tracks) && movie.audio_tracks.length > 0 ? movie.audio_tracks : null;
    const countries = Array.isArray(movie.production_countries) && movie.production_countries.length > 0 ? movie.production_countries : null;

    return (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center sm:p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-md"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-4xl bg-gray-900 md:rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col md:flex-row animate-slide-up md:animate-fade-in">

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-10 p-2 bg-black/50 rounded-full text-white hover:bg-white/20 transition-colors"
                >
                    ✕
                </button>

                {/* Poster Side */}
                <div className="w-full md:w-1/3 relative h-64 md:h-auto">
                    {movie.poster_path ? (
                        <img
                            src={`https://image.tmdb.org/t/p/w780${movie.poster_path}`}
                            className="w-full h-full object-cover"
                            alt={movie.title}
                        />
                    ) : (
                        <div className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-500 text-sm">
                            No Poster
                        </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent md:hidden" />
                </div>

                {/* Info Side */}
                <div className="flex-1 p-6 overflow-y-auto">
                    <h2 className="text-3xl font-bold text-white mb-1">{movie.title}</h2>

                    {movie.tagline && (
                        <p className="text-gray-500 italic text-sm mb-3">{movie.tagline}</p>
                    )}

                    <div className="flex flex-wrap gap-2 mb-3 text-sm text-gray-300">
                        <span className="bg-gray-800 px-2 py-1 rounded">{movie.release_date?.split('-')[0]}</span>
                        {runtime && <span className="bg-gray-800 px-2 py-1 rounded">{runtime}</span>}
                        {movie.note && (
                            <span className="bg-blue-900/50 text-blue-200 border border-blue-500/30 px-2 py-1 rounded">
                                {movie.note}
                            </span>
                        )}
                        {movie.video_format && <span className="uppercase border border-gray-600 px-2 py-1 rounded">{movie.video_format}</span>}
                    </div>

                    {genres && (
                        <div className="flex flex-wrap gap-1.5 mb-4">
                            {genres.map((g) => (
                                <span key={g} className="text-xs bg-purple-900/40 text-purple-300 border border-purple-500/20 px-2 py-0.5 rounded-full">
                                    {g}
                                </span>
                            ))}
                        </div>
                    )}

                    <p className="text-gray-300 leading-relaxed mb-6">
                        {movie.overview || "No plot summary available."}
                    </p>

                    <div className="grid grid-cols-2 gap-4 border-t border-gray-800 pt-4 text-sm">
                        <div>
                            <h4 className="text-gray-500 uppercase text-xs font-bold mb-1">Added</h4>
                            <p className="text-gray-300">{new Date(movie.added_at).toLocaleDateString()}</p>
                        </div>
                        <div>
                            <h4 className="text-gray-500 uppercase text-xs font-bold mb-1">UPC</h4>
                            <p className="font-mono text-gray-300">{movie.upc || 'N/A'}</p>
                        </div>
                        {audioTracks && (
                            <div className="col-span-2">
                                <h4 className="text-gray-500 uppercase text-xs font-bold mb-1">Audio</h4>
                                <p className="text-gray-300">{audioTracks.join(' · ')}</p>
                            </div>
                        )}
                        {countries && (
                            <div>
                                <h4 className="text-gray-500 uppercase text-xs font-bold mb-1">Country</h4>
                                <p className="text-gray-300">{countries.join(', ')}</p>
                            </div>
                        )}
                    </div>

                    {canDelete && (
                        <button
                            onClick={() => onDelete?.(movie)}
                            className="mt-6 w-full bg-red-700/90 hover:bg-red-700 text-white py-3 rounded-lg font-semibold"
                        >
                            Delete From Collection
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default MovieDetail;

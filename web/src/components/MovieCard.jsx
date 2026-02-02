import React from 'react';

function MovieCard({ movie, onClick }) {
    return (
        <div
            onClick={() => onClick(movie)}
            className="bg-gray-800 rounded-lg overflow-hidden group relative cursor-pointer hover:scale-105 transition-transform duration-200 shadow-lg"
        >
            {/* Status Indicator */}
            {movie.status === 'pending_enrichment' && (
                <div className="absolute top-2 right-2 w-3 h-3 bg-yellow-500 rounded-full animate-pulse shadow-md shadow-yellow-500/50" title="Enriching..." />
            )}

            {/* Poster */}
            {movie.poster_path ? (
                <img
                    src={`https://image.tmdb.org/t/p/w342${movie.poster_path}`}
                    className="w-full aspect-[2/3] object-cover"
                    loading="lazy"
                    alt={movie.title}
                />
            ) : (
                <div className="w-full aspect-[2/3] bg-gray-700 flex items-center justify-center text-gray-500">
                    No Poster
                </div>
            )}

            {/* Title Overlay (Gradient) - Mobile Friendly Text */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8">
                <h4 className="font-bold text-white text-sm line-clamp-2 leading-tight">
                    {movie.title}
                </h4>
                <p className="text-xs text-gray-400 mt-1">
                    {movie.release_date?.split('-')[0]}
                    {movie.note ? <span className="text-blue-400 ml-2 border border-blue-500/30 px-1 rounded text-[10px]">{movie.note}</span> : null}
                </p>
            </div>
        </div>
    );
}

export default MovieCard;

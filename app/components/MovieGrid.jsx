import React from 'react';
import MovieCard from './MovieCard';

function MovieGrid({ movies, loading, onMovieClick }) {
    if (loading) {
        return (
            <div className="flex justify-center items-center py-20">
                <div className="animate-spin text-4xl">💿</div>
            </div>
        );
    }

    if (movies.length === 0) {
        return (
            <div className="text-center py-20 text-gray-500">
                <p className="text-xl">Your collection is empty.</p>
                <p className="text-sm mt-2">Tap the + button to start scanning!</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 p-4 pb-24">
            {movies.map((movie) => (
                <MovieCard
                    key={movie.id}
                    movie={movie}
                    onClick={onMovieClick}
                />
            ))}
        </div>
    );
}

export default MovieGrid;

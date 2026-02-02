import json
import os
import requests
import sys
from datetime import datetime

# GitHub Actions will provide these environment variables
TMDB_API_KEY = os.environ.get("TMDB_API_KEY")
GITHUB_WORKSPACE = os.environ.get("GITHUB_WORKSPACE", ".")
MOVIES_FILE = os.path.join(GITHUB_WORKSPACE, "movies.json")

def load_movies():
    try:
        with open(MOVIES_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: {MOVIES_FILE} not found.")
        sys.exit(1)

def save_movies(data):
    with open(MOVIES_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def enrich_movie(movie):
    """
    Fetches detailed metadata from TMDB to enrich the movie entry.
    """
    movie_id = movie.get('id')
    print(f"Enriching: {movie.get('title')} (ID: {movie_id})...")
    
    url = f"https://api.themoviedb.org/3/movie/{movie_id}?api_key={TMDB_API_KEY}&append_to_response=release_dates,credits"
    res = requests.get(url)
    
    if res.status_code != 200:
        print(f"  Failed to fetch TMDB details: {res.status_code}")
        return movie # Return unchanged

    details = res.json()
    
    # Extract useful tech specs
    # 1. Runtime
    movie['runtime'] = details.get('runtime')
    
    # 2. Production Countries (Region hints)
    countries = [c['iso_3166_1'] for c in details.get('production_countries', [])]
    movie['production_countries'] = countries
    
    # 3. Spoken Languages (Audio hints)
    audio = [l['english_name'] for l in details.get('spoken_languages', [])]
    movie['audio_tracks'] = audio
    
    # 4. Status Update
    movie['status'] = 'enriched'
    movie['enriched_at'] = datetime.utcnow().isoformat()
    
    print(f"  > Added: {len(audio)} audio tracks, {movie['runtime']}m runtime.")
    return movie

def main():
    if not TMDB_API_KEY:
        print("Error: TMDB_API_KEY env var not set.")
        sys.exit(1)

    data = load_movies()
    movies = data.get('movies', [])
    updated = False
    
    for i, movie in enumerate(movies):
        if movie.get('status') == 'pending_enrichment':
            movies[i] = enrich_movie(movie)
            updated = True
            
    if updated:
        data['movies'] = movies
        save_movies(data)
        print("Successfully enriched movies and updated JSON.")
    else:
        print("No pending movies found.")

if __name__ == "__main__":
    main()

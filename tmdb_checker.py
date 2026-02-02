import os
import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime

def get_api_key():
    """Get TMDB API key from env var or user input."""
    key = os.environ.get('TMDB_API_KEY')
    if not key:
        print("Error: TMDB_API_KEY environment variable not found.")
        print("Please obtain a free API key from https://www.themoviedb.org/settings/api")
        print("Then run: export TMDB_API_KEY='your_key_here'")
        sys.exit(1)
    return key

def search_movie(api_key, query):
    """Search for a movie by title."""
    encoded_query = urllib.parse.quote(query)
    url = f"https://api.themoviedb.org/3/search/movie?api_key={api_key}&query={encoded_query}"
    
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            results = data.get('results', [])
            if not results:
                print("No movies found.")
                return None
            
            # Simple selection: take the first result or ask user (automating to first for now)
            print(f"Found {len(results)} results. selecting top result:")
            top_result = results[0]
            print(f"  Title: {top_result['title']} ({top_result.get('release_date', 'N/A')})")
            print(f"  ID: {top_result['id']}")
            return top_result['id']
    except Exception as e:
        print(f"Error searching movie: {e}")
        return None

def get_release_dates(api_key, movie_id):
    """Get release dates for a movie ID and filter for physical media."""
    url = f"https://api.themoviedb.org/3/movie/{movie_id}/release_dates?api_key={api_key}"
    
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            results = data.get('results', [])
            
            physical_releases = []
            
            for country_entry in results:
                iso_3166_1 = country_entry['iso_3166_1']
                for release in country_entry['release_dates']:
                    # Type 4 = Digital, Type 5 = Physical
                    if release['type'] == 5:
                        release['country'] = iso_3166_1
                        physical_releases.append(release)
            
            return physical_releases
    except Exception as e:
        print(f"Error getting details: {e}")
        return []

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 tmdb_checker.py \"Movie Title\"")
        sys.exit(1)

    api_key = get_api_key()
    query = sys.argv[1]
    
    print(f"--- Searching for: {query} ---")
    movie_id = search_movie(api_key, query)
    
    if movie_id:
        print("\n--- checking Physical Releases (Type 5) ---")
        releases = get_release_dates(api_key, movie_id)
        
        if not releases:
            print("No physical releases found in TMDB.")
        else:
            print(json.dumps(releases, indent=2))
            print(f"\nFound {len(releases)} physical release entries.")
            print("Note: Look for 'note' fields or lack thereof for technical specs.")

if __name__ == "__main__":
    main()

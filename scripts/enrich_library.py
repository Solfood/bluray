import json
import os
import time
import requests
from bs4 import BeautifulSoup
from duckduckgo_search import DDGS

DB_PATH = "movies.json"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.google.com/'
}

def load_db():
    if not os.path.exists(DB_PATH):
        return {"movies": []}
    with open(DB_PATH, 'r') as f:
        return json.load(f)

def save_db(data):
    data['updated_at'] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(DB_PATH, 'w') as f:
        json.dump(data, f, indent=2)

def find_bluray_url(title):
    try:
        query = f"site:blu-ray.com {title} blu-ray specs"
        print(f"Searching for: {query}")
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=3))
            if results:
                # Filter for actual movie pages (usually contain /movies/)
                for r in results:
                    if "/movies/" in r['href']:
                        return r['href']
                return results[0]['href']
    except Exception as e:
        print(f"Search error: {e}")
    return None

def scrape_specs(url):
    print(f"Scraping {url}...")
    try:
        resp = requests.get(url, headers=HEADERS)
        if resp.status_code != 200:
            return {}
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        text = soup.get_text()
        specs = {}
        
        # Simple string matching for now (robustness can be improved)
        if "Region: A" in text or "Region A" in text:
            specs['region'] = "A"
        elif "Region: B" in text:
            specs['region'] = "B"
        elif "Region free" in text.lower():
            specs['region'] = "Free"
            
        if "DTS-HD Master Audio" in text:
            specs['audio'] = "DTS-HD MA"
        elif "Dolby Atmos" in text:
            specs['audio'] = "Dolby Atmos"
            
        return specs
    except Exception as e:
        print(f"Scrape error: {e}")
        return {}

def main():
    db = load_db()
    movies = db.get('movies', [])
    updated = False
    
    for movie in movies:
        if movie.get('status') == 'pending_enrichment':
            print(f"Enriching: {movie['title']}")
            
            url = find_bluray_url(movie['title'])
            if url:
                print(f"Found URL: {url}")
                specs = scrape_specs(url)
                
                movie.update(specs)
                movie['bluray_url'] = url
                movie['status'] = 'enriched'
                updated = True
                
                # Sleep to be nice
                time.sleep(2)
            else:
                print("No details found.")
                movie['status'] = 'failed_enrichment'
                updated = True

    if updated:
        save_db(db)
        print("Database updated.")
    else:
        print("No pending movies.")

if __name__ == "__main__":
    main()

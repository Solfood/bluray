import sys
import requests
from bs4 import BeautifulSoup
import time
import re

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Referer': 'https://www.blu-ray.com/'
}

def search_bluray_com(query):
    """Searches blu-ray.com for a specific movie."""
    print(f"Searching for '{query}'...")
    base_url = "https://www.blu-ray.com/search/"
    params = {
        "quicksearch": "1",
        "quicksearch_country": "US",
        "quicksearch_keyword": query,
        "section": "bluraymovies"
    }
    
    try:
        response = requests.get(base_url, params=params, headers=HEADERS)
        if response.status_code != 200:
            print(f"Failed to search: {response.status_code}")
            return None
            
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Check if we landed directly on a product page (sometime happens with exact matches)
        if "Bluray-movies" in response.url or "/movies/" in response.url:
            print("Direct hit! Parsing page...")
            return parse_movie_page(soup)
            
        # Otherwise, parse search results
        results = []
        if not soup.select("a"):
             print("No links found in response! Response sample:")
             print(response.text[:500])
             
        for match in soup.select("a"):
            href = match.get('href', '')
            text = match.get_text().strip()
            
            # formatting checks
            if href and "movies" in href and "bluray" in href:
                 print(f"  Found candidate: '{text}' -> {href}")
                 if query.lower() in text.lower():
                     print("  Match found!")
                     return fetch_movie_details(href)
        
        print("No exact match found in search results.")
        return None

    except Exception as e:
        print(f"Error during search: {e}")
        return None

def fetch_movie_details(url):
    """Fetches a specific movie page."""
    print(f"Fetching details from {url}...")
    try:
        response = requests.get(url, headers=HEADERS)
        if response.status_code != 200:
            print("Failed to fetch page.")
            return None
        return parse_movie_page(BeautifulSoup(response.text, 'html.parser'))
    except Exception as e:
        print(f"Error fetching details: {e}")
        return None

def parse_movie_page(soup):
    """Parses technical specs from the movie page."""
    specs = {}
    
    print("Parsing movie page...")
    text = soup.get_text()
    if len(text) < 500:
        print(f"Page text seems too short ({len(text)} chars). Dumping body:")
        print(soup.prettify()[:1000])
        
    # Regex extraction for common specs
    
    # Regex extraction for common specs
    
    # Audio
    audio_match = re.search(r'(DTS-HD Master Audio.*?)\n', text)
    if not audio_match:
         audio_match = re.search(r'(Dolby TrueHD.*?)\n', text)
    if not audio_match:
         audio_match = re.search(r'(Dolby Atmos.*?)\n', text)
         
    if audio_match:
        specs['Audio'] = audio_match.group(1).strip()
        
    # Video / Resolution
    video_match = re.search(r'(Video\s*Codec:.*?)\n', text, re.IGNORECASE | re.DOTALL)
    if video_match:
        # Grab the line
        specs['Video Line'] = video_match.group(1).strip()

    # Subtitles
    sub_section = soup.find(string=re.compile("Subtitles"))
    if sub_section and sub_section.parent.parent:
        # Try to find the container
        specs['Subtitles_hint'] = "Found subtitle section"

    # Discs
    disc_match = re.search(r'(Blu-ray Disc.*?\n)', text)
    if disc_match:
        specs['Discs'] = disc_match.group(1).strip()
        
    # Packaging
    packaging_match = re.search(r'(SteelBook|DigiBook|Slipcover)', text, re.IGNORECASE)
    if packaging_match:
        specs['Packaging'] = packaging_match.group(1)

    return specs

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 details_scraper.py \"Movie Title\"")
        sys.exit(1)

    query = sys.argv[1]
    
    if "blu-ray.com" in query and "http" in query:
        print("Detected direct URL...")
        specs = fetch_movie_details(query)
    else:
        specs = search_bluray_com(query)
    
    if specs:
        print("\n--- Scraped Technical Specs ---")
        for k, v in specs.items():
            print(f"{k}: {v}")
    else:
        print("Could not retrieve full specs (Regex mismatch?), but page was accessed.")

if __name__ == "__main__":
    main()

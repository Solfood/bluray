import requests
from bs4 import BeautifulSoup
import time
import sys

# Test scraping a specific page with known UPC
# Let's try to search or just hit a movie page directly.
# A common trick is hitting the search endpoint or a known movie ID.
# Example movie: Spider-Man Into the Spider-Verse (ID: 219732 is often used, but let's just search first)

def test_scrape_bluray_com():
    # Use a realistic User-Agent
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
    }

    print("Testing connection to blu-ray.com...")
    
    # Let's search by UPC. blu-ray.com has a search box.
    # We can try to craft a search URL.
    test_upc = "043396538887" # Spider-Man: Into the Spider-Verse 4K
    
    # The search URL usually looks like: https://www.blu-ray.com/search/?quicksearch=1&quicksearch_keyword=043396538887&section=bluraymovies
    url = f"https://www.blu-ray.com/search/?quicksearch=1&quicksearch_keyword={test_upc}&section=bluraymovies"
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            # Check if we hit a captcha or cloudflare block
            title = soup.title.string if soup.title else "No Title"
            print(f"Page Title: {title}")
            
            if "Just a moment" in title or "Cloudflare" in title or "Access Denied" in title:
                print("❌ Blocked by Cloudflare or anti-bot protection!")
                return False
                
            # See if we can find the movie link or if it redirected us to the movie directly
            print("✅ Successfully fetched page.")
            
            if "Spider-Man:" in response.text or "Spider-Verse" in response.text:
                print("✅ Found expected movie text on page!")
            else:
                print("⚠️ Page fetched, but didn't find the expected movie text. Might just be parsing differences.")
                
            return True
        elif response.status_code in [403, 429]:
            print(f"❌ Blocked! Status code {response.status_code}")
            return False
        else:
            print(f"⚠️ Unexpected status code: {response.status_code}")
            return False

    except Exception as e:
        print(f"❌ Error during request: {e}")
        return False

if __name__ == "__main__":
    success = test_scrape_bluray_com()
    if not success:
         sys.exit(1)


import requests
import re
import urllib.parse
import os

# Mock keys (User provided in previous context or I will ask if needed, 
# but for now I can use the public UPCItemDB and just check the title cleaning)
# I need a TMDB key to fully verify.
# I will just verify the UPC -> Title -> Clean step first.

def test_logic(upc):
    print(f"Testing UPC: {upc}")
    
    # 1. UPCItemDB
    url = f"https://api.upcitemdb.com/prod/trial/lookup?upc={upc}"
    resp = requests.get(url)
    data = resp.json()
    
    if not data.get('items'):
        print("UPCItemDB: No items found.")
        return

    raw_title = data['items'][0]['title']
    print(f"Raw Title: '{raw_title}'")
    
    # 2. Clean Title Logic (Mirrors JS)
    # const cleanTitle = rawTitle.split(/[\[\(]/)[0].trim(); 
    clean_title = re.split(r'[\[\(]', raw_title)[0].strip()
    print(f"Clean Title: '{clean_title}'")
    
    print("---")
    print(f"Next step would be: GET https://api.themoviedb.org/3/search/movie?query={urllib.parse.quote(clean_title)}")

test_logic("715515116916")

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url: string, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchJsonWithRetry(url: string, retries = 2, backoff = 600, timeoutMs = 7000): Promise<any | null> {
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) {
      if (retries > 0 && res.status >= 500) throw new Error(`Status ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    if (retries > 0) {
      await sleep(backoff);
      return fetchJsonWithRetry(url, retries - 1, Math.floor(backoff * 1.5), timeoutMs);
    }
    throw e;
  }
}

export function tmdbGet(pathAndQuery: string): Promise<any | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return Promise.resolve(null);
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  return fetchJsonWithRetry(`${TMDB_BASE_URL}${pathAndQuery}${sep}api_key=${key}`).catch(() => null);
}

export async function searchMovie(query: string): Promise<any[]> {
  const data = await tmdbGet(`/search/movie?query=${encodeURIComponent(query)}`);
  return data?.results || [];
}

export async function findByUpc(upc: string): Promise<any[]> {
  const data = await tmdbGet(`/find/${upc}?external_source=upc`);
  return data?.movie_results || [];
}

export function getMovieDetails(tmdbId: number): Promise<any | null> {
  return tmdbGet(`/movie/${tmdbId}?append_to_response=release_dates,credits`);
}

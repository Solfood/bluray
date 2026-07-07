import { getDb } from '../db/index';
import { getMovie, updateMovie } from '../db/movies';
import { getMovieDetails } from './tmdb';

const stringArray = (value: any, pick: (item: any) => any, max = 20): string[] =>
  (Array.isArray(value) ? value : [])
    .map(pick)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .slice(0, max);

const cappedString = (value: any, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

export async function runEnrichment(pk: number): Promise<void> {
  const db = getDb();
  const movie = getMovie(db, pk);
  if (!movie) return;

  const tmdbId = movie.tmdb_id ?? (/^\d+$/.test(movie.id) ? Number(movie.id) : null);
  if (!tmdbId) {
    updateMovie(db, pk, { status: 'needs_tmdb_match' });
    return;
  }

  let details: any;
  try {
    details = await getMovieDetails(tmdbId);
  } catch {
    details = null;
  }
  if (!details) {
    updateMovie(db, pk, { status: 'enrich_failed' });
    return;
  }

  updateMovie(db, pk, {
    runtime: Number.isInteger(details.runtime) ? details.runtime : null,
    production_countries: stringArray(details.production_countries, (c) => c?.iso_3166_1),
    audio_tracks: stringArray(details.spoken_languages, (l) => l?.english_name),
    genres: stringArray(details.genres, (g) => g?.name),
    tagline: cappedString(details.tagline, 500),
    overview: cappedString(details.overview, 2000) || movie.overview || '',
    status: 'enriched',
    enriched_at: new Date().toISOString(),
  });
}

import { describe, it, expect } from 'vitest';
import {
  normalizeTitle, buildTitleVariants, safeYear, normalizeScanOrInput,
  buildUpcCandidates, scoreMovieCandidate, moviesMatch,
} from './movies';

describe('matching utils', () => {
  it('normalizes titles', () => {
    expect(normalizeTitle('The Matrix (4K UHD) [Steelbook]')).toBe('the matrix');
  });

  it('builds title variants from noisy product titles', () => {
    const variants = buildTitleVariants('Inception 4K Ultra HD Blu-ray Steelbook');
    expect(variants).toContain('Inception');
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it('parses safe years', () => {
    expect(safeYear('2006-10-04')).toBe(2006);
    expect(safeYear('n/a')).toBeNull();
  });

  it('normalizes scans: 8+ digits become bare digits, else raw text', () => {
    expect(normalizeScanOrInput(' 8-8392-98008-15 ')).toBe('883929800815');
    expect(normalizeScanOrInput('In Bruges')).toBe('In Bruges');
  });

  it('builds UPC candidates with EAN/UPC zero-padding variants', () => {
    expect(buildUpcCandidates('0883929800815')).toEqual(['0883929800815', '883929800815']);
    expect(buildUpcCandidates('883929800815')).toEqual(['883929800815', '0883929800815']);
  });

  it('scores exact title+year matches highest', () => {
    const exact = scoreMovieCandidate({ title: 'The Departed', release_date: '2006-10-04' }, 'The Departed', 2006);
    const off = scoreMovieCandidate({ title: 'Departure', release_date: '2019-01-01' }, 'The Departed', 2006);
    expect(exact).toBeGreaterThan(120);
    expect(exact).toBeGreaterThan(off);
  });

  it('matches movies on added_at, upc+title, or id+title', () => {
    expect(moviesMatch({ added_at: 'x' }, { added_at: 'x' })).toBe(true);
    expect(moviesMatch({ id: 1, title: 'A' }, { id: 1, title: 'B' })).toBe(false);
  });
});

export const TITLE_NOISE_WORDS = new Set([
  '4k', 'uhd', 'ultra', 'hd', 'blu', 'ray', 'bluray', 'dvd', 'digital', 'code', 'edition',
  'steelbook', 'limited', 'collectors', 'collector', 'special', 'remastered', 'region', 'disc',
  'discs', 'video', 'arrow', 'criterion'
]);

export const moviesMatch = (a, b) => {
  if (!a || !b) return false;
  if (a.added_at && b.added_at && a.added_at === b.added_at) return true;
  if (a.upc && b.upc && a.upc === b.upc && a.title === b.title) return true;
  if (a.id != null && b.id != null && a.id === b.id && a.title === b.title) return true;
  return false;
};

export const normalizeTitle = (value) =>
  (value || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const cleanProductTitle = (value) => {
  const text = (value || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[|/]/g, ' ')
    .replace(/\b(4k|uhd|ultra\s*hd|blu[\s-]?ray|dvd|digital\s*code|steelbook|limited\s*edition|collector'?s?\s*edition|arrow\s*video|criterion)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || (value || '').trim();
};

export const buildTitleVariants = (value) => {
  const raw = (value || '').trim();
  if (!raw) return [];

  const variants = new Set();
  variants.add(cleanProductTitle(raw));
  variants.add(raw.split(/[:\-|]/)[0].trim());
  variants.add(raw.split(/[\[(]/)[0].trim());

  const cleanedWords = cleanProductTitle(raw)
    .split(/\s+/)
    .filter((w) => w && !TITLE_NOISE_WORDS.has(w.toLowerCase()));
  if (cleanedWords.length) variants.add(cleanedWords.join(' '));

  return [...variants]
    .map((v) => v.replace(/\s+/g, ' ').trim())
    .filter((v) => v.length >= 2)
    .slice(0, 4);
};

export const safeYear = (value) => {
  if (!value) return null;
  const y = String(value).slice(0, 4);
  return /^\d{4}$/.test(y) ? Number(y) : null;
};

export const normalizeScanOrInput = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 8 ? digits : trimmed;
};

export const buildUpcCandidates = (rawUpc) => {
  const digits = (rawUpc || '').replace(/\D/g, '');
  if (!digits) return [];
  const variants = new Set([digits]);
  if (digits.length === 13 && digits.startsWith('0')) variants.add(digits.slice(1));
  if (digits.length === 12) variants.add(`0${digits}`);
  return [...variants];
};

export const sortMoviesNewestFirst = (items) =>
  [...(items || [])].sort((a, b) => {
    const aTs = Date.parse(a?.added_at || 0);
    const bTs = Date.parse(b?.added_at || 0);
    return (Number.isNaN(bTs) ? 0 : bTs) - (Number.isNaN(aTs) ? 0 : aTs);
  });

export const scoreMovieCandidate = (candidate, preferredTitle, preferredYear) => {
  let score = 0;
  const candTitle = normalizeTitle(candidate.title || '');
  const prefTitle = normalizeTitle(preferredTitle || '');

  if (candTitle && prefTitle) {
    if (candTitle === prefTitle) score += 100;
    else if (candTitle.includes(prefTitle) || prefTitle.includes(candTitle)) score += 65;

    const candWords = new Set(candTitle.split(' ').filter(Boolean));
    const prefWords = prefTitle.split(' ').filter(Boolean);
    const overlap = prefWords.filter((w) => candWords.has(w)).length;
    score += Math.min(overlap * 6, 30);
  }

  const candYear = safeYear(candidate.release_date);
  if (candYear && preferredYear) {
    const delta = Math.abs(candYear - preferredYear);
    if (delta === 0) score += 35;
    else if (delta === 1) score += 20;
    else if (delta <= 3) score += 8;
  }

  return score;
};

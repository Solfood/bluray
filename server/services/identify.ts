import type { Database } from 'better-sqlite3';
import { lookupByIdentifiedTitle } from './lookup';

const COST_PER_SCAN = 0.001;
const MAX_B64_LENGTH = 1_400_000; // ~1 MB decoded
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PROMPT =
  'This is a photo of a Blu-ray or 4K disc cover. Identify the movie.\n' +
  'Respond with a raw JSON object only — no markdown, no code fences, no extra text.\n' +
  'Example: {"title":"The Matrix","year":1999,"edition":"4K Ultra HD"}\n' +
  'If you cannot identify a title, respond: {"title":null}';

export function getMonthlyUsage(db: Database) {
  const month = new Date().toISOString().slice(0, 7);
  const row = db.prepare(
    'SELECT COUNT(*) AS scans, COALESCE(SUM(cost), 0) AS cost FROM scan_usage WHERE month = ?'
  ).get(month) as any;
  return { month, scans: row.scans, cost: Math.round(row.cost * 10000) / 10000 };
}

async function anthropicErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({} as any));
  const type = body?.error?.type || '';
  const msg = body?.error?.message || '';
  if (type === 'authentication_error') return 'Invalid Anthropic API key — check the server env.';
  if (type === 'permission_error' || msg.toLowerCase().includes('credit')) {
    return 'Anthropic credits exhausted — add credits at console.anthropic.com/settings/billing';
  }
  if (type === 'rate_limit_error' || response.status === 429) return 'Rate limited — wait a moment and try again.';
  if (type === 'overloaded_error' || response.status === 529) return 'Anthropic is overloaded — try again shortly.';
  return msg || `API error ${response.status}`;
}

export async function identifyCover(db: Database, image: string, mediaType: string) {
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'Cover identification is not configured on the server.', status: 503 };
  if (typeof image !== 'string' || image.length === 0 || image.length > MAX_B64_LENGTH) {
    return { error: 'image must be base64, max ~1MB', status: 400 };
  }
  if (!MEDIA_TYPES.has(mediaType)) return { error: 'media_type must be image/jpeg, image/png, or image/webp', status: 400 };

  const rawCap = Number(process.env.SCAN_MONTHLY_CAP || 200);
  const cap = Number.isFinite(rawCap) && rawCap >= 0 ? rawCap : 200;

  // Cap check + usage INSERT run back-to-back with no await in between.
  // better-sqlite3 is synchronous, so on Node's single thread this
  // check-and-reserve is atomic: two concurrent requests at cap-1 cannot
  // both pass. The row is a reservation — released below if the API call fails.
  const usage = getMonthlyUsage(db);
  if (usage.scans >= cap) {
    return { error: `Monthly scan cap reached (${cap}). Raise SCAN_MONTHLY_CAP if intentional.`, status: 429 };
  }
  const reservation = db.prepare('INSERT INTO scan_usage (month, created_at, cost) VALUES (?, ?, ?)')
    .run(new Date().toISOString().slice(0, 7), new Date().toISOString(), COST_PER_SCAN);
  const releaseReservation = () =>
    db.prepare('DELETE FROM scan_usage WHERE id = ?').run(reservation.lastInsertRowid);

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 128,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
  } catch {
    releaseReservation();
    return { error: 'Could not reach Anthropic — network error, try again.', status: 502 };
  }

  if (!response.ok) {
    releaseReservation();
    return { error: await anthropicErrorMessage(response), status: 502 };
  }

  const data: any = await response.json().catch(() => null);
  const raw = data?.content?.[0]?.text?.trim() || '';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    releaseReservation();
    return { error: `Unexpected model response: ${raw.slice(0, 80)}`, status: 502 };
  }

  if (!parsed?.title || typeof parsed.title !== 'string') {
    return { identified: null, usage: getMonthlyUsage(db) };
  }

  const title = parsed.title.trim().slice(0, 300);
  const year = Number.isInteger(Number(parsed.year)) && parsed.year ? Number(parsed.year) : null;
  const edition = typeof parsed.edition === 'string' ? parsed.edition.trim().slice(0, 200) : '';

  const candidates = await lookupByIdentifiedTitle(title, year);
  return { identified: { title, year, edition }, candidates: candidates.slice(0, 8), usage: getMonthlyUsage(db) };
}

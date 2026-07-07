import type { ActionFunctionArgs } from 'react-router';
import { getDb } from '../../server/db/index';
import { createMovie } from '../../server/services/movies-api';
import { runEnrichment } from '../../server/services/enrich';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const input = await request.json().catch(() => null);
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result: any = createMovie(getDb(), input);
  if (result.error) return Response.json({ error: result.error }, { status: result.status });

  if (result.record.status === 'pending_enrichment') {
    void runEnrichment(result.record.pk).catch((e) => console.error('enrichment failed', e));
  }
  return Response.json(result.record, { status: 201 });
}

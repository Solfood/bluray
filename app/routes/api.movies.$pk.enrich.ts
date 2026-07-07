import type { ActionFunctionArgs } from 'react-router';
import { getDb } from '../../server/db/index';
import { getMovie, rowToApi } from '../../server/db/movies';
import { runEnrichment } from '../../server/services/enrich';

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const pk = Number(params.pk);
  const db = getDb();
  if (!Number.isInteger(pk) || !getMovie(db, pk)) return Response.json({ error: 'Not found' }, { status: 404 });
  await runEnrichment(pk);
  return Response.json(rowToApi(getMovie(db, pk)));
}

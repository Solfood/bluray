import type { ActionFunctionArgs } from 'react-router';
import { getDb } from '../../server/db/index';
import { patchMovie, removeMovie } from '../../server/services/movies-api';

export async function action({ request, params }: ActionFunctionArgs) {
  const pk = Number(params.pk);
  if (!Number.isInteger(pk)) return Response.json({ error: 'Invalid pk' }, { status: 400 });
  const db = getDb();

  if (request.method === 'PATCH') {
    const input = await request.json().catch(() => null);
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const result: any = patchMovie(db, pk, input);
    if (result.error) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result.record);
  }

  if (request.method === 'DELETE') {
    const result: any = removeMovie(db, pk);
    if (result.error) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result);
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}

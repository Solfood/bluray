import type { ActionFunctionArgs } from 'react-router';
import { getDb } from '../../server/db/index';
import { identifyCover } from '../../server/services/identify';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  const result: any = await identifyCover(getDb(), body.image, body.media_type);
  if (result.error) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result);
}

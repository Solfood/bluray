import type { LoaderFunctionArgs } from 'react-router';
import { lookupQuery } from '../../server/services/lookup';

export async function loader({ request }: LoaderFunctionArgs) {
  const q = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (!q || q.length > 200) return Response.json({ error: 'q is required, max 200 chars' }, { status: 400 });
  return Response.json(await lookupQuery(q));
}

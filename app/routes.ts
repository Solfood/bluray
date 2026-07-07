import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.jsx'),
  route('api/lookup', 'routes/api.lookup.ts'),
  route('api/identify', 'routes/api.identify.ts'),
  route('api/movies', 'routes/api.movies.ts'),
  route('api/movies/:pk', 'routes/api.movies.$pk.ts'),
  route('api/movies/:pk/enrich', 'routes/api.movies.$pk.enrich.ts'),
] satisfies RouteConfig;

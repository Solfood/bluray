# bluray

Self-hosted Blu-ray collection manager: React Router v7 full-stack app with a
SQLite database, server-side TMDB lookup and enrichment, Claude cover-photo
identification, and a nightly `movies.json` backup pushed to GitHub.

## Develop

```bash
npm install
npm run dev      # app on http://localhost:5173
npm test         # vitest suite
```

## Deploy (bluray.local)

```bash
cp .env.example .env        # fill in keys; .env is gitignored

# One-time data import — run on the HOST before first boot. ./data is the
# volume the container mounts, so the imported DB is what the app serves.
# (tsx is a devDependency and is pruned from the production image, which is
# why the import runs host-side.)
DATA_DIR=./data npm run import -- ./movies.json

docker compose up -d --build
# app on http://bluray.local:3000
```

Keep the service LAN-only (see the note in `compose.yaml`) — never
port-forward it on the router.

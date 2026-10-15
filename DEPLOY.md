# GhostFxPro - Paper (dry-run) deployment guide

**Important:** This is paper-only. Live trading is disabled by default and not implemented. Real orders will not be placed.

## Option A: Docker Compose (EC2/Railway/Fly/VM)

1. Copy .env.example to .env on the server and fill values.
2. Generate MFA_ENCRYPTION_KEY (base64 32 bytes): 
ode -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"
3. Start: docker compose up -d
4. API: http://<host>:4000/health
5. Web: http://<host>:3000

## Option B: Node (EC2/VM)

`ash
npm ci
npm run build --workspaces --if-present 2>/dev/null || echo 'no build step'
# API (PGlite data dir persisted)
export PGLITE_DATA_DIR=/data/gfp
mkdir -p /data/gfp
npm run start:api  # if you add it, else: node --import tsx apps/api/src/server.ts (prod uses pg)
`

## Environment

- PAPER_ENGINE_ENABLED=1 keeps the paper bot running continuously (dry-run).
- Use PGlite in dev; production server.ts uses pg (needs DATABASE_URL). See README for details.

The bot is dry-run only. No real trades executed.

# ccanext – CCA GraphQL API (Next.js)

Migrated GraphQL API from CCA (Fastify) to Next.js. All queries and mutations are supported.

## Setup

1. Copy `.env.example` to `.env` and fill in values (same as CCA).
2. Ensure database is migrated (use CCA migrations or run from ccanext).
3. `npm install && npm run dev`

## Endpoints

- **GraphQL**: `http://localhost:3000/api/graphql`
- Queries, mutations supported. Subscriptions (SSE) available for future use.

## Running with ccaui

- Start ccanext: `cd ccanext && npm run dev` (port 3000)
- Start ccaui: `cd ccaui && npm run dev` (e.g. port 3001)
- In ccaui `.env.local`: `NEXT_PUBLIC_GRAPHQL_URI=http://localhost:3000/api/graphql`

## WebSocket (live games)

The live game WebSocket (`/ws/game/:gameId`) is not in ccanext (Vercel serverless cannot host WebSockets). Use CCA for WebSocket or deploy a separate cca-ws service.

## Vercel

Deploy ccanext as a Vercel project. Set env vars: `DATABASE_URL`, `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CORS_ORIGIN`.

# ccanext — CCA GraphQL API

Next.js-hosted GraphQL API over Prisma + Supabase Postgres. Serves `ccaweb` (public site + platform), `ccaui` (legacy app, until cutover) and `ccaadmin` (staff console). Live gameplay lives in the separate `cca` service.

**Read before schema work:** `../docs/BUILD_PLAN.md` §3 (the data model), §4 (rules that span services) and §6 (the query surface).

---

## Hard rules

### Migrations are applied by hand

The sandbox cannot reach Supabase. Every schema change ships **two** things:

1. The `schema.prisma` edit.
2. An **idempotent** `prisma/manual_apply_<topic>.sql` — `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, enum creation wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`, indexes with `IF NOT EXISTS`, and the RLS enable statements matching the existing files.

Never run `prisma migrate deploy` against production. Write the SQL, commit it, and tell the user to apply it in the Supabase SQL editor. Follow the pattern already set by `manual_apply_placement_admin.sql` and `manual_apply_community_tournaments.sql`.

### Git

- **`main` only.** No feature branches, no PRs, no fork workflows. Confirm `git branch --show-current` before committing; confirm with the user before pushing.
- **Never `git add -A` in this repo.** Another fork stages files here. Stage individually and check `git diff --cached` before committing.

### Additive only

`User`, `School`, `Game`, `Tournament`, `TournamentRound`, `TournamentPairing`, `PlayerRating`, `PlacementRun`, `AdminUser`, `Activity` are all load-bearing for shipped surfaces. Extend them; do not rename or drop. New domains get new tables.

**Before extending the schema, verify the live database matches it.** `docs/COMMUNITY_TOURNAMENTS_TRACKER.md` contradicts itself about whether its migration was applied — check the actual Supabase tables rather than trusting the file.

---

## Architecture

```
graphql/
  typeDefs.ts              SDL
  context.ts               auth (player JWT) + optional admin JWT
  resolvers/               one file per domain, registered in index.ts
domains/<domain>/
  <domain>.service.ts      business logic
  <domain>.repository.ts   Prisma access
  <pure>.ts                pure, unit-tested logic (e.g. tournament/pairing.ts)
```

**The pattern worth copying is `domains/tournament/pairing.ts`**: all pairing and tiebreak maths lives in a dependency-free module with real tests (Swiss no-rematch, colour balance, byes, Buchholz, Sonneborn-Berger). Do the same for fixture scoring and standings — see below.

---

## Domain model

Vocabulary — **School** (institution) · **Club** (the chess club inside it) · **Membership** · **Season** · **Division** (league group, named after its catchment, never a bare region name) · **Zone** (four groupings feeding zonal finals) · **Region** (Cameroon's ten, a canonical key like `SOUTH_WEST`, not a zone and not free text) · **Fixture** (team match, N boards) · **FixtureBoard** (one pairing) · **Game** (online or over the board).

`Fixture.homeClubId` and `awayClubId` are **nullable on purpose**: a bye has no away club, and a cup placeholder has neither until its feeding ties resolve.

**Fixture ≠ Tournament.** Team match days and cup ties use `Fixture` + `FixtureBoard`. The existing `Tournament`/`Round`/`Pairing` tables stay for individual events — rapids, Swiss opens, arenas — and keep their pairing engine untouched.

### Invariants the API must enforce

1. **Fixture score is derived** from `FixtureBoard.result` + `homeColor`, recomputed on every board write. Never accepted from a client.
2. **Division tables are derived** from `VALIDATED` fixtures only. Never incremented in place.
3. **A board rates exactly once**, at validation, guarded by `FixtureBoard.ratedAt` set in the same transaction. Ratings and career ledgers read `FixtureBoard`, not `Game` — so an over-the-board board with no moves recorded still counts, and no `Game` row need exist for it. The `cca` server must skip its own rating write for any game whose `validationState != NOT_REQUIRED`, or fixture games rate twice.
4. **Consent gates display, not participation.** A pending-consent player plays, rates and appears in standings — as "Brenda A.". Implement the full truth table in BUILD_PLAN §4.3 **once**, as `toPublicPlayer()` in `domains/user/publicPlayer.ts`, and route every public resolver that returns a name through it — `publicPlayer`, `playerStandings`, `clubRoster`, fixture board players, activity authors. Unknown age counts as a minor. A full name must never reach a public client, and `Club.joinCode` must never appear on a public type.
5. **One result encoding.** `FixtureBoard.result` reuses the existing `GameResult` enum — there is no second string format and no mapping layer. White-first (`1-0`) and home-first (`2½–1½`) are **display** rules, resolved from `homeColor` at render time.

### Ratings

Glicko-2 lives in `PlayerRating` (rating, deviation, volatility); `users.rating` mirrors a rounded copy for display. Placement seeds it. Do not add a second rating system — one CCA national rating is the decision.

---

## Testing

`npx tsc --noEmit` and a valid SDL are the floor for every change. Pure domain modules (scoring, standings, pairing, the placement estimator) get real unit tests with adversarial cases — odd club counts, byes, half-points, a fixture where both boards' home colours differ. Resolver-level tests are welcome but not a substitute.

Before saying a change works end-to-end, verify it against the deployed API rather than assuming — the house pattern is a DB + public-API check that doesn't require an admin login.

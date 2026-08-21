/**
 * THE CONSENT RULE — implemented ONCE, here. BUILD_PLAN §4.3.
 *
 * Every public resolver that returns a person's name MUST go through
 * `toPublicPlayer()`. A public resolver added later that forgets it leaks a
 * minor's full name silently — there is no test that will fail, no error, and
 * nothing in the response to show it happened. That is the whole reason this
 * lives in one file.
 *
 * Consent gates DISPLAY, not participation (§3.3 #5): a player with pending
 * consent still plays, still rates and still appears in standings — as
 * "Brenda A.".
 *
 * The complete truth table, in order:
 *
 *   | Condition                                          | Public name | Avatar |
 *   |----------------------------------------------------|-------------|--------|
 *   | Profile.dateOfBirth present and age >= 18           | Full name   | Shown  |
 *   | Minor · consent GRANTED · publicNameMode = FULL     | Full name   | Shown  |
 *   | Minor · consent GRANTED · publicNameMode = INITIAL  | "Brenda A." | Hidden |
 *   | Minor · PENDING / DECLINED / WITHDRAWN / no row     | "Brenda A." | Hidden |
 *   | No Profile, or no dateOfBirth                       | "Brenda A." | Hidden |
 *
 * Two consequences worth stating out loud, because they are easy to "fix" by
 * mistake:
 *
 *   • UNKNOWN AGE IS TREATED AS A MINOR. No Profile at all, or a Profile with a
 *     null dateOfBirth, takes the protective branch. This is deliberate: the
 *     failure mode of guessing "probably an adult" is a child's full name on a
 *     public web page.
 *
 *   • AN ADULT ALWAYS SHOWS IN FULL, whatever `publicNameMode` says. The first
 *     row of the table carries no mode condition, and the owner re-stated it as
 *     locked: "Full name only when the player is 18+, OR is a minor with consent
 *     GRANTED AND publicNameMode = FULL." `publicNameMode` is a MINOR's control.
 *
 * Pure module: no Prisma import, no I/O, so it is trivially testable and cannot
 * be tempted into "just one more query".
 */

// ── Value types ───────────────────────────────────────────────────────────────
// String unions rather than imports from `@prisma/client`, so this module stays
// dependency-free. Structurally identical to the generated enums, so a Prisma
// row passes straight in.

export type ConsentStatusValue = "PENDING" | "GRANTED" | "DECLINED" | "WITHDRAWN";
export type PublicNameModeValue = "INITIAL" | "FULL";

/** The generated crest triple (BUILD_PLAN §5). Null when the club has none yet. */
export interface Crest {
  shield: string;
  band: string;
  charge: string;
}

export interface PublicPlayerProfileSource {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: Date | string | null;
  avatarUrl?: string | null;
}

export interface PublicPlayerConsentSource {
  status?: ConsentStatusValue | string | null;
}

export interface PublicPlayerClubSource {
  slug?: string | null;
  name?: string | null;
  shortName?: string | null;
  crestJson?: unknown;
}

export interface PublicPlayerMembershipSource {
  schoolYear?: string | null;
  boardOrder?: number | null;
  club?: PublicPlayerClubSource | null;
}

/**
 * What `toPublicPlayer` needs. Every field is optional except `id`, so a caller
 * that forgets an include degrades to the PROTECTIVE branch rather than to a
 * leak: a missing `profile` reads as "unknown age" and reduces the name.
 */
export interface PublicPlayerSource {
  id: string;
  username?: string | null;
  rating?: number | null;
  publicNameMode?: PublicNameModeValue | string | null;
  profile?: PublicPlayerProfileSource | null;
  guardianConsent?: PublicPlayerConsentSource | null;
  /** The player's ACTIVE membership (BUILD_PLAN §4.2). Pass one, or `memberships`. */
  membership?: PublicPlayerMembershipSource | null;
  /** Convenience: a `memberships` include filtered to ACTIVE. The first is used. */
  memberships?: PublicPlayerMembershipSource[] | null;
}

/** The shape of the `PublicPlayer` GraphQL type, exactly. */
export interface PublicPlayer {
  id: string;
  /** Already reduced when full display is not permitted. */
  displayName: string;
  /** null unless full display is permitted. */
  avatarUrl: string | null;
  rating: number;
  clubSlug: string | null;
  clubName: string | null;
  clubShortName: string | null;
  crest: Crest | null;
  schoolYear: string | null;
  boardOrder: number | null;
}

export const ADULT_AGE = 18;

// ── Age ───────────────────────────────────────────────────────────────────────

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole years between `dob` and `now`. Null when the date of birth is unusable. */
export function ageInYears(
  dateOfBirth: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  const dob = toDate(dateOfBirth);
  if (!dob) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

/**
 * TRUE unless we can positively establish the person is 18 or over.
 * No profile, no date of birth, an unparseable date, or a future date all
 * return true — unknown age is a minor.
 */
export function isMinor(
  profile: PublicPlayerProfileSource | null | undefined,
  now: Date = new Date()
): boolean {
  if (!profile) return true;
  const age = ageInYears(profile.dateOfBirth, now);
  if (age === null) return true;
  return age < ADULT_AGE;
}

// ── Consent ───────────────────────────────────────────────────────────────────

export function isConsentGranted(
  consent: PublicPlayerConsentSource | null | undefined
): boolean {
  return consent?.status === "GRANTED";
}

/**
 * The name mode that actually applies. `publicNameMode` may only be FULL while
 * consent is GRANTED — "revoking consent forces it back to INITIAL" (§4.3).
 *
 * That is a WRITE rule, but it is enforced here on READ as well, deliberately:
 * if a WITHDRAWN row ever coexists with a stale `FULL` column (a failed write, a
 * hand-edited row, a restore from backup), display must still reduce.
 */
export function effectivePublicNameMode(
  mode: PublicNameModeValue | string | null | undefined,
  consent: PublicPlayerConsentSource | null | undefined
): PublicNameModeValue {
  if (mode !== "FULL") return "INITIAL";
  return isConsentGranted(consent) ? "FULL" : "INITIAL";
}

/**
 * What `users.publicNameMode` must become when consent changes state. For the
 * Phase 2 write path (there is no consent mutation in Phase 1) — so that rule
 * is written down once, here, next to the read rule it protects.
 */
export function publicNameModeOnConsentChange(
  status: ConsentStatusValue | string | null | undefined,
  requested: PublicNameModeValue | string | null | undefined
): PublicNameModeValue {
  if (status !== "GRANTED") return "INITIAL";
  return requested === "FULL" ? "FULL" : "INITIAL";
}

// ── Names ─────────────────────────────────────────────────────────────────────

function firstGrapheme(value: string): string {
  return Array.from(value)[0] ?? "";
}

/** "Brenda Ateba" -> "Brenda A." · "Brenda" -> "Brenda" · nothing -> the username. */
export function reducedName(
  profile: PublicPlayerProfileSource | null | undefined,
  username?: string | null
): string {
  const first = profile?.firstName?.trim() ?? "";
  const last = profile?.lastName?.trim() ?? "";
  if (first && last) return `${first} ${firstGrapheme(last).toUpperCase()}.`;
  if (first) return first;
  // No name on file. The username is the account's already-public handle
  // (it is on every leaderboard and game record today), so it is the least
  // surprising fallback — and it is never a full legal name we introduced.
  const handle = username?.trim();
  return handle && handle.length > 0 ? handle : "Player";
}

export function fullName(
  profile: PublicPlayerProfileSource | null | undefined,
  username?: string | null
): string {
  const first = profile?.firstName?.trim() ?? "";
  const last = profile?.lastName?.trim() ?? "";
  const joined = `${first} ${last}`.trim();
  if (joined) return joined;
  const handle = username?.trim();
  return handle && handle.length > 0 ? handle : "Player";
}

// ── Crest ─────────────────────────────────────────────────────────────────────

/**
 * `Club.crestJson` is `Json?`. Return the triple only when all three parts are
 * present — a half-written crest is worse than none, because `ccaweb`'s
 * `<ClubCrest />` derives a complete one deterministically from the slug when
 * this is null (BUILD_PLAN §5).
 */
export function parseCrest(crestJson: unknown): Crest | null {
  if (!crestJson || typeof crestJson !== "object" || Array.isArray(crestJson)) return null;
  const c = crestJson as Record<string, unknown>;
  const { shield, band, charge } = c;
  if (typeof shield !== "string" || typeof band !== "string" || typeof charge !== "string") {
    return null;
  }
  if (!shield || !band || !charge) return null;
  return { shield, band, charge };
}

// ── The one function ──────────────────────────────────────────────────────────

/**
 * Reduce a user row to what the public may see.
 *
 * Route EVERY public resolver that returns a name through this — `publicPlayer`,
 * `playerStandings`, `clubRoster`, fixture board players, activity authors.
 * A full name must never leave the API for an unauthenticated consumer.
 */
export function toPublicPlayer(
  source: PublicPlayerSource,
  opts: { now?: Date } = {}
): PublicPlayer {
  const now = opts.now ?? new Date();
  const profile = source.profile ?? null;
  const membership = source.membership ?? source.memberships?.[0] ?? null;
  const club = membership?.club ?? null;

  const adult = !isMinor(profile, now);
  const mode = effectivePublicNameMode(source.publicNameMode, source.guardianConsent);
  const showFull = adult || mode === "FULL";

  return {
    id: source.id,
    displayName: showFull
      ? fullName(profile, source.username)
      : reducedName(profile, source.username),
    // The avatar is a photograph of a child. It travels with the name.
    avatarUrl: showFull ? profile?.avatarUrl ?? null : null,
    rating: Math.round(source.rating ?? 0),
    clubSlug: club?.slug ?? null,
    clubName: club?.name ?? null,
    clubShortName: club?.shortName ?? null,
    crest: parseCrest(club?.crestJson),
    schoolYear: membership?.schoolYear ?? null,
    boardOrder: membership?.boardOrder ?? null,
  };
}

/** Convenience for list resolvers, so `now` is the same across a whole page. */
export function toPublicPlayers(
  sources: PublicPlayerSource[],
  opts: { now?: Date } = {}
): PublicPlayer[] {
  const now = opts.now ?? new Date();
  return sources.map((s) => toPublicPlayer(s, { now }));
}

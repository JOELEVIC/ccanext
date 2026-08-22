/**
 * WHO MAY SEE A PERSON'S REAL IDENTITY — the viewer-aware half of BUILD_PLAN §4.3.
 *
 * `publicPlayer.ts` answers one question: *may the PUBLIC see this person in
 * full?* That is enough for `PublicPlayer`, a type that only ever carries a
 * reduced person. It is not enough for `User` and `Profile`, which are the same
 * types the owner reads on their own settings page and staff read in the
 * console. Those need a second question: *who is asking?*
 *
 * So the rule is composed, never duplicated:
 *
 *     reveal  =  isPrivilegedViewer(viewer, subject)      // self, or staff
 *             OR canShowFullIdentity(subject)             // §4.3, from publicPlayer.ts
 *
 * There is no third consent implementation in here — `canShowFullIdentity()` is
 * imported from the one file that owns the truth table. If §4.3 changes, it
 * changes there and every GraphQL field guard follows automatically.
 *
 * ── Field by field ───────────────────────────────────────────────────────────
 *
 *   User.email          Never public. Not a display field at all: nothing on any
 *                       public surface renders it, and it is the single most
 *                       useful thing an attacker can lift from a table of 28
 *                       schoolchildren. Self and staff only — no consent branch,
 *                       because consent governs DISPLAY and an email is not a
 *                       display.
 *
 *   Profile.dateOfBirth Never public. It is the INPUT to the consent decision,
 *                       not an output (see the note in `publicPlayer.select.ts`).
 *                       Self and staff only.
 *
 *   Profile.lastName    §4.3. Reduced to the initial form ("Ateba" -> "A.") for a
 *                       non-consented minor, so `firstName + " " + lastName`
 *                       renders "Brenda A." — the exact string §4.3 specifies and
 *                       the exact string `reducedName()` already produces.
 *
 *   Profile.avatarUrl   §4.3, second column of the truth table. The avatar is a
 *                       photograph of a child; it travels with the name, exactly
 *                       as it does in `toPublicPlayer()`.
 *
 *   Profile.firstName   NOT guarded — deliberately. The reduced identity §4.3
 *                       specifies is "Brenda A.": the given name survives in
 *                       full and only the surname collapses. Reducing the given
 *                       name too would render "B. A.", which contradicts the
 *                       truth table's own worked example and would disagree with
 *                       `PublicPlayer.displayName` on the very same person.
 *                       `visibleFirstName()` exists so that decision is written
 *                       down in code rather than implied by an absence.
 *
 * Pure module: no Prisma, no I/O, no `@/` alias. The Prisma-aware loader that
 * feeds it lives in `identityGate.ts`.
 */

import {
  canShowFullIdentity,
  lastNameInitial,
  type PublicNameModeValue,
  type PublicPlayerConsentSource,
  type PublicPlayerProfileSource,
} from "./publicPlayer";

// ── Viewer ────────────────────────────────────────────────────────────────────

/**
 * The caller, reduced to the only two things that grant privilege.
 *
 * `isStaff` must come from `context.admin` — the console's SEPARATE token,
 * signed with `ADMIN_JWT_SECRET`. It must never be derived from
 * `context.user.role`: a player token saying `role: "NATIONAL_ADMIN"` is a
 * claim made by whoever holds the player signing key, and privilege that a
 * player token can assert is privilege an attacker can mint.
 */
export interface Viewer {
  /** The authenticated player's id, when a player token was presented. */
  userId?: string | null;
  /** True only for a verified staff (admin console) token. */
  isStaff?: boolean;
}

/**
 * The consent inputs plus the person's own name parts, assembled by
 * `IdentityGate`. Everything is optional so an incomplete row degrades to the
 * protective branch rather than to a leak.
 */
export interface IdentitySubject {
  userId: string;
  publicNameMode?: PublicNameModeValue | string | null;
  profile?: PublicPlayerProfileSource | null;
  guardianConsent?: PublicPlayerConsentSource | null;
}

/**
 * The person themselves, or staff. The ONLY two viewers who may read a field
 * that is never public (email, date of birth), and the only two who bypass the
 * §4.3 reduction.
 *
 * An anonymous caller has no `userId`, so the `self` arm cannot be reached by
 * omission: `undefined === undefined` is never asked, both sides are checked
 * for truthiness first.
 */
export function isPrivilegedViewer(
  viewer: Viewer | null | undefined,
  subjectUserId: string | null | undefined
): boolean {
  if (!viewer) return false;
  if (viewer.isStaff === true) return true;
  const self = viewer.userId;
  return Boolean(self) && Boolean(subjectUserId) && self === subjectUserId;
}

/**
 * May this viewer see the person's real identity — full surname, photograph?
 *
 * Privileged viewer, OR the public is already allowed to (§4.3). The second arm
 * is `canShowFullIdentity()` from `publicPlayer.ts`, unmodified.
 */
export function mayRevealIdentity(
  viewer: Viewer | null | undefined,
  subject: IdentitySubject,
  opts: { now?: Date } = {}
): boolean {
  if (isPrivilegedViewer(viewer, subject.userId)) return true;
  return canShowFullIdentity(subject, opts);
}

// ── Field guards ──────────────────────────────────────────────────────────────

/** `User.email` — self and staff only, whatever consent says. */
export function visibleEmail(
  viewer: Viewer | null | undefined,
  subjectUserId: string | null | undefined,
  email: string | null | undefined
): string | null {
  return isPrivilegedViewer(viewer, subjectUserId) ? email ?? null : null;
}

/** `Profile.dateOfBirth` — self and staff only. Consent INPUT, never an output. */
export function visibleDateOfBirth<T>(
  viewer: Viewer | null | undefined,
  subjectUserId: string | null | undefined,
  dateOfBirth: T | null | undefined
): T | null {
  return isPrivilegedViewer(viewer, subjectUserId) ? dateOfBirth ?? null : null;
}

/**
 * `Profile.lastName` — "Ateba" for a permitted viewer, "A." otherwise.
 *
 * Returns a string, never null: `lastName` is `String!` in the SDL and staying
 * non-null is what keeps every existing client query valid.
 */
export function visibleLastName(
  viewer: Viewer | null | undefined,
  subject: IdentitySubject,
  opts: { now?: Date } = {}
): string {
  const last = subject.profile?.lastName ?? "";
  return mayRevealIdentity(viewer, subject, opts) ? last : lastNameInitial(last);
}

/**
 * `Profile.firstName` — always the given name in full. See the header note:
 * §4.3's reduced identity is "Brenda A.", not "B. A.".
 */
export function visibleFirstName(
  _viewer: Viewer | null | undefined,
  subject: IdentitySubject
): string {
  return subject.profile?.firstName ?? "";
}

/** `Profile.avatarUrl` — the photograph travels with the name (§4.3, column 2). */
export function visibleAvatarUrl(
  viewer: Viewer | null | undefined,
  subject: IdentitySubject,
  opts: { now?: Date } = {}
): string | null {
  return mayRevealIdentity(viewer, subject, opts) ? subject.profile?.avatarUrl ?? null : null;
}

// ── Self-disclosure ───────────────────────────────────────────────────────────

/**
 * `login`, `register` and `loginWithGoogle` return the caller's OWN account in
 * `AuthPayload.user` — but the request that produced it carried no token yet, so
 * `context.user` is empty and `isPrivilegedViewer()` would (correctly) refuse.
 *
 * The mutation resolvers therefore stamp the payload's user with this marker:
 * the account was just authenticated by this very request, so it is self by
 * construction. A `Symbol` property is invisible to GraphQL field resolution,
 * to `JSON.stringify` and to object spread, so it cannot escape into a response
 * or be forged by anything a client sends.
 */
const SELF_DISCLOSED: unique symbol = Symbol("cca.identity.selfDisclosed");

export function markSelfDisclosed<T extends object>(value: T): T {
  Object.defineProperty(value, SELF_DISCLOSED, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return value;
}

export function isSelfDisclosed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as Record<symbol, unknown>)[SELF_DISCLOSED] === true;
}

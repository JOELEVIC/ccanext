/**
 * The per-request object the GraphQL field guards call. Prisma-aware companion
 * to the pure `identityVisibility.ts`, in the same way `publicPlayer.select.ts`
 * is the Prisma-aware companion to `publicPlayer.ts`.
 *
 * WHY A LOADER AT ALL. The §4.3 decision needs three facts — the person's date
 * of birth, their `publicNameMode`, and their `GuardianConsent.status`. A
 * `Profile` row carries the first; the other two live on `User` and on a
 * separate table. `Profile.lastName` is resolved once per row of a leaderboard,
 * so the naive guard is one query per row per field. This batches every id
 * requested in the same tick into a single `findMany`, and caches per request,
 * so `lastName` + `avatarUrl` on 25 players costs one query, not fifty.
 *
 * FAILING CLOSED. Every read path here degrades towards REDACTION:
 *   • a user id the reader does not return   -> no consent inputs -> minor
 *   • the whole read throws                  -> no consent inputs -> minor
 *   • the club/consent columns not migrated  -> DOB-only fallback (see below)
 * The one thing that must never happen is a full name reaching an anonymous
 * caller because a query failed, so no error here is allowed to open a field.
 */

import type { PrismaClient } from "@prisma/client";
import {
  isSelfDisclosed,
  isPrivilegedViewer,
  visibleAvatarUrl,
  visibleDateOfBirth,
  visibleEmail,
  visibleFirstName,
  visibleLastName,
  type IdentitySubject,
  type Viewer,
} from "./identityVisibility";

/** The three §4.3 inputs, for one person. */
export interface ConsentInputs {
  userId: string;
  publicNameMode: string | null;
  dateOfBirth: Date | null;
  consentStatus: string | null;
}

/** Batched read of the §4.3 inputs. Injectable so the gate is testable without Prisma. */
export type ConsentReader = (userIds: string[]) => Promise<ConsentInputs[]>;

/** A `Profile` row as it reaches a field resolver. Everything optional but `userId`. */
export interface ProfileParent {
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  dateOfBirth?: Date | null;
}

/** A `User` row as it reaches a field resolver. */
export interface UserParent {
  id: string;
  email?: string | null;
}

// ── Prisma reader ─────────────────────────────────────────────────────────────

/**
 * Reads the §4.3 inputs for a batch of user ids.
 *
 * `users.publicNameMode` and the `guardian_consents` table arrive with
 * `manual_apply_clubs_seasons.sql`, which is applied by hand and may not be in
 * a given database yet. If selecting them fails, this retries with only the
 * columns that have always existed. That fallback cannot open anything up:
 * without a consent row no minor can be `FULL`, so "no consent inputs" is
 * exactly the decision the full query would have produced anyway — an adult
 * (row 1 of the truth table, which needs only a date of birth) still shows in
 * full, and everyone else is reduced.
 */
export function prismaConsentReader(prisma: PrismaClient): ConsentReader {
  return async (userIds: string[]): Promise<ConsentInputs[]> => {
    if (userIds.length === 0) return [];
    try {
      const rows = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          publicNameMode: true,
          profile: { select: { dateOfBirth: true } },
          guardianConsent: { select: { status: true } },
        },
      });
      return rows.map((r) => ({
        userId: r.id,
        publicNameMode: r.publicNameMode ?? null,
        dateOfBirth: r.profile?.dateOfBirth ?? null,
        consentStatus: r.guardianConsent?.status ?? null,
      }));
    } catch {
      try {
        const rows = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, profile: { select: { dateOfBirth: true } } },
        });
        return rows.map((r) => ({
          userId: r.id,
          publicNameMode: null,
          dateOfBirth: r.profile?.dateOfBirth ?? null,
          consentStatus: null,
        }));
      } catch {
        // Nothing readable. Every caller now sees the protective branch.
        return [];
      }
    }
  };
}

// ── Batching loader ───────────────────────────────────────────────────────────

/**
 * Coalesces every id asked for in the same tick into one `read()` call and
 * memoises the result for the life of the request.
 *
 * A rejected read resolves to `null` rather than propagating: a field guard
 * must fail closed, not fail the query. (`prismaConsentReader` already swallows
 * its own errors; this covers any other reader.)
 */
export function createConsentLoader(read: ConsentReader) {
  const cache = new Map<string, Promise<ConsentInputs | null>>();
  let batch: string[] = [];
  let inFlight: Promise<Map<string, ConsentInputs>> | null = null;

  function schedule(): Promise<Map<string, ConsentInputs>> {
    if (inFlight) return inFlight;
    inFlight = new Promise<Map<string, ConsentInputs>>((resolve) => {
      queueMicrotask(() => {
        const ids = batch;
        batch = [];
        inFlight = null;
        Promise.resolve(read(ids)).then(
          (rows) => resolve(new Map(rows.map((r) => [r.userId, r]))),
          () => resolve(new Map()),
        );
      });
    });
    return inFlight;
  }

  return function load(userId: string): Promise<ConsentInputs | null> {
    const hit = cache.get(userId);
    if (hit) return hit;
    batch.push(userId);
    const pending = schedule().then((byId) => byId.get(userId) ?? null);
    cache.set(userId, pending);
    return pending;
  };
}

// ── The gate ──────────────────────────────────────────────────────────────────

/**
 * One per GraphQL request, built in `graphql/context.ts`. The field resolvers on
 * `User` and `Profile` call nothing else.
 */
export class IdentityGate {
  private readonly load: (userId: string) => Promise<ConsentInputs | null>;

  constructor(
    private readonly viewer: Viewer,
    read: ConsentReader,
    private readonly opts: { now?: Date } = {},
  ) {
    this.load = createConsentLoader(read);
  }

  /** `User.email` — no consent branch, so no load. */
  email(user: UserParent): string | null {
    // The account this very request just authenticated (login / register).
    if (isSelfDisclosed(user)) return user.email ?? null;
    return visibleEmail(this.viewer, user.id, user.email);
  }

  /** `Profile.dateOfBirth` — no consent branch, so no load. */
  dateOfBirth(profile: ProfileParent): Date | null {
    return visibleDateOfBirth(this.viewer, profile.userId, profile.dateOfBirth);
  }

  /** `Profile.firstName` — full, always. Routed through so the decision is visible. */
  firstName(profile: ProfileParent): string {
    return visibleFirstName(this.viewer, { userId: profile.userId, profile });
  }

  /** `Profile.lastName` — "Ateba", or "A." for a non-consented minor. */
  async lastName(profile: ProfileParent): Promise<string> {
    if (isPrivilegedViewer(this.viewer, profile.userId)) return profile.lastName ?? "";
    return visibleLastName(this.viewer, await this.subject(profile), this.opts);
  }

  /** `Profile.avatarUrl` — hidden with the name (§4.3, column 2). */
  async avatarUrl(profile: ProfileParent): Promise<string | null> {
    if (isPrivilegedViewer(this.viewer, profile.userId)) return profile.avatarUrl ?? null;
    return visibleAvatarUrl(this.viewer, await this.subject(profile), this.opts);
  }

  /**
   * The parent `Profile` row plus the consent inputs it does not carry.
   *
   * The date of birth is taken from the loader FIRST and only then from the
   * parent: a resolver whose parent was selected without `dateOfBirth` must not
   * read as "no date of birth, therefore… " — well, therefore a minor, which is
   * still safe, but it would wrongly reduce an adult. Reading it back from the
   * loader makes the decision independent of what the calling query selected.
   */
  private async subject(profile: ProfileParent): Promise<IdentitySubject> {
    const row = await this.load(profile.userId);
    return {
      userId: profile.userId,
      publicNameMode: row?.publicNameMode ?? null,
      guardianConsent: row?.consentStatus ? { status: row.consentStatus } : null,
      profile: {
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        dateOfBirth: row?.dateOfBirth ?? profile.dateOfBirth ?? null,
      },
    };
  }
}

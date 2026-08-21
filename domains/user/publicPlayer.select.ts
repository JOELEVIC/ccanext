import { MembershipStatus, Prisma } from "@prisma/client";

/**
 * The Prisma-aware companion to the pure `publicPlayer.ts`.
 *
 * A `select`, never an `include`: an `include` on `user` would drag `email` and
 * `passwordHash` into memory on every public roster, standings and fixture read.
 * This lists exactly what `toPublicPlayer()` needs to apply BUILD_PLAN §4.3 —
 * the name parts, the date of birth that decides minor-or-adult, the consent
 * row, and the ONE active membership that resolves club, school year and board
 * order (§4.2).
 *
 * `dateOfBirth` is selected but never returned: it is an INPUT to the consent
 * decision, not an output. No public GraphQL type carries it.
 */
export const publicPlayerSelect = {
  id: true,
  username: true,
  rating: true,
  publicNameMode: true,
  profile: {
    select: {
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      avatarUrl: true,
    },
  },
  guardianConsent: { select: { status: true } },
  memberships: {
    where: { status: MembershipStatus.ACTIVE },
    take: 1,
    select: {
      schoolYear: true,
      boardOrder: true,
      club: {
        select: {
          slug: true,
          name: true,
          shortName: true,
          crestJson: true,
          // Region and level are how `playerStandings` filters a player into a
          // regional or university table (§4.2). They are club facts, not
          // personal data.
          region: true,
          level: true,
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

/** A user row loaded with exactly `publicPlayerSelect`. */
export type PublicPlayerRow = Prisma.UserGetPayload<{ select: typeof publicPlayerSelect }>;

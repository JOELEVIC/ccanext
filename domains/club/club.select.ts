import { Prisma } from "@prisma/client";
import { parseCrest, type Crest } from "@/domains/user/publicPlayer";

/**
 * The public projection of a club.
 *
 * `joinCode` IS DELIBERATELY ABSENT (BUILD_PLAN §3.3 #6). This is a `select`,
 * not an `omit`: on every public read path the column is never fetched from
 * Postgres at all, so it cannot be forwarded by accident, logged by accident,
 * or exposed by a future GraphQL field that resolves off `parent`.
 *
 * The only place a join code is read is `clubRepository.findByJoinCode()`, which
 * looks a club UP by its code and returns this same code-free projection.
 */
export const clubPublicSelect = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  region: true,
  level: true,
  status: true,
  // Public because a person deciding whether to browse a club's roster should
  // see that it has one to browse, rather than tapping through to an empty
  // list. The flag says "this club keeps its members to itself"; it does not
  // say who they are.
  isPrivate: true,
  crestJson: true,
  foundedOn: true,
  createdAt: true,
  updatedAt: true,
  schoolId: true,
  school: {
    select: {
      id: true,
      name: true,
      region: true,
      slug: true,
      kind: true,
      town: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ClubSelect;

export type ClubPublicRow = Prisma.ClubGetPayload<{ select: typeof clubPublicSelect }>;

/** The shape the `Club` GraphQL type resolves against. */
export interface PublicClub extends Omit<ClubPublicRow, "crestJson"> {
  crest: Crest | null;
  memberCount?: number;
  honours?: unknown[];
}

export function toPublicClub(row: ClubPublicRow, memberCount?: number): PublicClub {
  const { crestJson, ...rest } = row;
  return { ...rest, crest: parseCrest(crestJson), ...(memberCount === undefined ? {} : { memberCount }) };
}

export function toPublicClubOrNull(
  row: ClubPublicRow | null | undefined,
  memberCount?: number
): PublicClub | null {
  return row ? toPublicClub(row, memberCount) : null;
}

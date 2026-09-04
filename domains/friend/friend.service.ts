import type { FriendshipStatus, PrismaClient } from "@prisma/client";
import { AuthorizationError, NotFoundError, ValidationError } from "@/utils/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Friends.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why accept-based, and never a follow ─────────────────────────────────
 *
 * A follow is something you do TO somebody. A friendship is something two
 * people agree to. The distinction is usually a matter of taste and here it
 * is not: the members of this platform are schoolchildren, and the whole
 * point of the relation is that it gives one person standing to send another
 * a direct invitation to a game. Standing like that has to be given.
 *
 * ── One row per pair, in whichever direction it was asked ────────────────
 *
 * The unique index is on the ORDERED pair, which is all an index can do. The
 * rule the product needs is that A and B have at most one relationship
 * between them however it started, and that is enforced here in [between] —
 * every write reads both directions first.
 *
 * BLOCKED lives on the same row rather than in a table of its own. Somebody
 * who blocks a person is saying "no, and stop asking"; a block stored
 * elsewhere would let the next request be created by a query that never
 * joined against it.
 *
 * ── What this service does not do ────────────────────────────────────────
 *
 * It does not reduce names. Every player-bearing field on the way out goes
 * through `toPublicPlayer` in the resolver, exactly as a club roster does, so
 * a non-consented minor is "Brenda A." to their own friends as well. Being
 * somebody's friend is not consent to publish their name — those are
 * different questions and §4.3 answers the second one.
 */

export class FriendService {
  constructor(private prisma: PrismaClient) {}

  /**
   * The relationship between two people, in whichever direction it exists.
   *
   * The one read every write starts from. Without it the unique index would
   * happily hold `(A,B) PENDING` beside `(B,A) ACCEPTED`, which is two
   * different answers to one question.
   */
  private async between(a: string, b: string) {
    return this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: a, addresseeId: b },
          { requesterId: b, addresseeId: a },
        ],
      },
    });
  }

  /**
   * Ask somebody to be a friend.
   *
   * Idempotent in the useful direction: asking twice returns the request that
   * already exists rather than failing, because a person who taps a button
   * they are not sure registered should not be told off.
   *
   * The one case that is not idempotent is the interesting one — if THEY have
   * already asked YOU, this accepts instead of creating a mirrored request.
   * Two people who reach for each other at the same moment end up friends,
   * which is what both of them were asking for.
   */
  async request(requesterId: string, addresseeId: string) {
    if (requesterId === addresseeId) {
      throw new ValidationError("You cannot add yourself.");
    }

    const target = await this.prisma.user.findUnique({
      where: { id: addresseeId },
      select: { id: true },
    });
    if (!target) throw new NotFoundError("That player does not exist.");

    const existing = await this.between(requesterId, addresseeId);
    if (existing) {
      if (existing.status === "BLOCKED") {
        // Deliberately the same sentence somebody would get for a player who
        // has simply not answered. Telling A that B blocked them is telling A
        // something B did not choose to say.
        throw new AuthorizationError("That request could not be sent.");
      }
      if (existing.status === "ACCEPTED") return existing;
      // They asked first: answering is what was meant.
      if (existing.addresseeId === requesterId) {
        return this.respond(requesterId, existing.id, true);
      }
      return existing;
    }

    return this.prisma.friendship.create({
      data: { requesterId, addresseeId },
    });
  }

  /**
   * Answer a request addressed to you.
   *
   * Declining DELETES the row rather than marking it. A declined request is
   * not a fact anybody needs kept: keeping it would mean the person who asked
   * can see they were refused, and would block them from ever asking again
   * after the two met properly. Blocking is the durable "no", and it is a
   * separate act somebody chooses.
   */
  async respond(userId: string, friendshipId: string, accept: boolean) {
    const row = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
    });
    if (!row) throw new NotFoundError("That request no longer exists.");
    if (row.addresseeId !== userId) {
      throw new AuthorizationError("That request was not addressed to you.");
    }
    if (row.status !== "PENDING") return row;

    if (!accept) {
      await this.prisma.friendship.delete({ where: { id: friendshipId } });
      return { ...row, status: "DECLINED" as const };
    }

    return this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
  }

  /** Undo a friendship, or withdraw a request you sent. Either side, any time. */
  async remove(userId: string, otherId: string) {
    const row = await this.between(userId, otherId);
    if (!row) return false;
    if (row.status === "BLOCKED" && row.requesterId !== userId) {
      // The blocked party cannot lift the block that is against them.
      throw new AuthorizationError("That could not be undone.");
    }
    await this.prisma.friendship.delete({ where: { id: row.id } });
    return true;
  }

  /**
   * Block somebody. Replaces whatever was between you.
   *
   * The requester on a BLOCKED row is always the person who did the blocking,
   * which is what lets [remove] tell "lift my own block" from "escape
   * somebody else's".
   */
  async block(userId: string, otherId: string) {
    if (userId === otherId) throw new ValidationError("You cannot block yourself.");
    const existing = await this.between(userId, otherId);
    if (existing) {
      await this.prisma.friendship.delete({ where: { id: existing.id } });
    }
    return this.prisma.friendship.create({
      data: {
        requesterId: userId,
        addresseeId: otherId,
        status: "BLOCKED",
        respondedAt: new Date(),
      },
    });
  }

  /** Everyone who has accepted, or whom I have accepted. */
  async friendsOf(userId: string): Promise<string[]> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  }

  /** Requests waiting on me, and the ones I am waiting on. */
  async pendingFor(userId: string) {
    return this.prisma.friendship.findMany({
      where: {
        status: "PENDING",
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /**
   * Whether [viewerId] may send [targetId] a direct invitation.
   *
   * Used by the challenge path, not by this domain's own screens. A friendship
   * is one of three ways to earn that standing — the others are sharing a club
   * and the target simply being open to anyone.
   */
  async areFriends(viewerId: string, targetId: string): Promise<boolean> {
    const row = await this.between(viewerId, targetId);
    return row?.status === "ACCEPTED";
  }

  /** Whether either party has blocked the other. Checked before every invite. */
  async isBlocked(a: string, b: string): Promise<boolean> {
    const row = await this.between(a, b);
    return row?.status === "BLOCKED";
  }

  /** For the resolver's status field on a looked-up player. */
  async statusBetween(
    viewerId: string,
    targetId: string,
  ): Promise<FriendshipStatus | "NONE" | "PENDING_THEM"> {
    const row = await this.between(viewerId, targetId);
    if (!row) return "NONE";
    if (row.status === "PENDING") {
      return row.requesterId === viewerId ? "PENDING" : "PENDING_THEM";
    }
    return row.status;
  }
}

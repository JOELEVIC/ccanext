import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { GameResult } from "@prisma/client";

import { fullMoves, verifyGame, type ClaimedOutcome } from "./verify";

/**
 * The board behind a shared challenge link.
 *
 * Not to be confused with `domains/challenge`, which is a player challenging
 * another PLAYER to a live game. This is the public, link-shaped thing: a
 * scenario anybody can be sent, and the results people post against it.
 *
 * It is the second public unauthenticated write on this API, and it is
 * defended the way the first one is. `EnquiryService` set the pattern: an IP
 * throttle backed by a TABLE, because Vercel serverless has no shared memory
 * and an in-process counter resets with every cold container. The digest is
 * stored, never the address.
 *
 * ── What is stored about a person ─────────────────────────────────────────
 *
 * A handle they typed. That is the whole list — no name, no email, no account,
 * no address. Whoever submits arrived from a message thread and may well be a
 * child, and BUILD_PLAN §4.3 treats unknown age as a minor. There is nothing
 * here to reduce because nothing identifying was collected.
 *
 * ── Trusting the caller with nothing ──────────────────────────────────────
 *
 * The scenario id is RECOMPUTED from the submitted terms rather than taken on
 * faith. That is what stops a forged easy position being filed under a hard
 * scenario's board: change the FEN and you change the id, so the fake lands on
 * its own board instead of poisoning a real one — and this API needs no copy
 * of the position catalogue to make it true.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;
const IP_LIMIT = 40;
const MAX_HANDLE = 18;

export type SubmitResultCode = "OK" | "VALIDATION" | "REJECTED" | "RATE_LIMITED" | "ERROR";

export interface SubmitChallengeResultInput {
  scenarioId: string;
  handle: string;
  botId: string;
  positionSlug?: string | null;
  colour: string;
  clockId?: string | null;
  startFen: string;
  /** SAN, space-separated. */
  movesSAN: string;
  outcome: string;
}

export interface SubmitChallengeResultAnswer {
  ok: boolean;
  code: SubmitResultCode;
  id: string | null;
  verified: boolean;
  message: string;
}

export interface BoardRow {
  handle: string;
  moves: number;
  createdAt: Date;
}

export interface ChallengeBoardView {
  scenarioId: string;
  /** Verified wins, fewest moves first. The ranked part. */
  wins: BoardRow[];
  /** Everyone who posted anything, verified or not. */
  attempts: number;
  winCount: number;
}

/**
 * FNV-1a, 32-bit, base36 — byte-identical to `hashString` in the web app's
 * `lib/brand/crest.ts`. Duplicated on purpose: the two services share no code,
 * and an id that disagreed across them would silently split every board in
 * half. If one changes, both change.
 */
function scenarioHash(parts: string[]): string {
  const input = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Public display text. Anything that could carry markup or layout is out. */
export function cleanHandle(raw: string): string {
  return raw
    .replace(/[<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_HANDLE);
}

export class ChallengeBoardService {
  constructor(private prisma: PrismaClient) {}

  async submitResult(
    input: SubmitChallengeResultInput,
    ip: string | null,
  ): Promise<SubmitChallengeResultAnswer> {
    const handle = cleanHandle(input.handle ?? "");
    if (handle.length < 2) {
      return reject("VALIDATION", "Choose a handle of at least two characters.");
    }

    const colour = input.colour === "b" ? "b" : input.colour === "w" ? "w" : null;
    const outcome = ["won", "lost", "drew"].includes(input.outcome)
      ? (input.outcome as ClaimedOutcome)
      : null;
    if (!colour || !outcome) return reject("VALIDATION", "That result could not be read.");

    const expected = scenarioHash([
      input.botId,
      input.positionSlug ?? "",
      colour,
      input.clockId ?? "",
      input.startFen,
    ]);
    if (expected !== input.scenarioId) {
      return reject("REJECTED", "That result does not match the challenge it claims.");
    }

    const movesSAN = (input.movesSAN ?? "").trim();
    const check = verifyGame({
      startFen: input.startFen,
      movesSAN: movesSAN ? movesSAN.split(/\s+/) : [],
      colour,
      outcome,
    });
    if (!check.ok) {
      return reject(
        "REJECTED",
        check.error === "CONTRADICTED"
          ? "The moves do not end the way that result says."
          : "That game could not be replayed.",
      );
    }

    if (ip && !(await this.allow(sha256(ip)))) {
      return reject("RATE_LIMITED", "That is a lot of results from one place today.");
    }

    // White-first, like every other result in this schema. The submitter's own
    // outcome is derived from this and their colour, never stored twice.
    const result =
      outcome === "drew"
        ? GameResult.DRAW
        : (outcome === "won") === (colour === "w")
          ? GameResult.WHITE_WIN
          : GameResult.BLACK_WIN;

    try {
      const row = await this.prisma.challengeResult.create({
        data: {
          scenarioId: input.scenarioId,
          handle,
          result,
          colour,
          moves: fullMoves(check.plies),
          verified: check.verified,
          movesSAN,
          botId: input.botId,
          positionSlug: input.positionSlug ?? null,
          clockId: input.clockId ?? null,
          startFen: input.startFen,
        },
        select: { id: true },
      });
      return {
        ok: true,
        code: "OK",
        id: row.id,
        verified: check.verified,
        message: check.verified ? "Your result is on the board." : "Your result is recorded.",
      };
    } catch (error) {
      // A write failure must not surface as a masked GraphQL error — the
      // reader would see nothing and retry into the throttle.
      console.error("[challengeBoard] result write failed", error);
      return reject("ERROR", "That could not be saved. Try again in a moment.");
    }
  }

  async board(scenarioId: string, limit = 20): Promise<ChallengeBoardView> {
    const take = Math.min(Math.max(limit, 1), 50);
    const [rows, attempts, winCount] = await Promise.all([
      this.prisma.challengeResult.findMany({
        where: {
          scenarioId,
          verified: true,
          // A win for the submitter is their colour taking the point.
          OR: [
            { result: GameResult.WHITE_WIN, colour: "w" },
            { result: GameResult.BLACK_WIN, colour: "b" },
          ],
        },
        orderBy: [{ moves: "asc" }, { createdAt: "asc" }],
        take,
        select: { handle: true, moves: true, createdAt: true },
      }),
      this.prisma.challengeResult.count({ where: { scenarioId } }),
      this.prisma.challengeResult.count({
        where: {
          scenarioId,
          verified: true,
          OR: [
            { result: GameResult.WHITE_WIN, colour: "w" },
            { result: GameResult.BLACK_WIN, colour: "b" },
          ],
        },
      }),
    ]);

    return { scenarioId, wins: rows, attempts, winCount };
  }

  /** The same table-backed window `EnquiryService` uses. */
  private async allow(key: string): Promise<boolean> {
    const now = new Date();
    const existing = await this.prisma.challengeThrottle.findUnique({ where: { key } });

    if (!existing || now.getTime() - existing.windowStartedAt.getTime() > WINDOW_MS) {
      await this.prisma.challengeThrottle.upsert({
        where: { key },
        create: { key, count: 1, windowStartedAt: now, lastSeenAt: now },
        update: { count: 1, windowStartedAt: now, lastSeenAt: now },
      });
      return true;
    }

    if (existing.count >= IP_LIMIT) return false;

    await this.prisma.challengeThrottle.update({
      where: { key },
      data: { count: { increment: 1 }, lastSeenAt: now },
    });
    return true;
  }
}

function reject(code: SubmitResultCode, message: string): SubmitChallengeResultAnswer {
  return { ok: false, code, id: null, verified: false, message };
}

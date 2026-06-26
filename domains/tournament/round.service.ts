import type { PrismaClient } from "@prisma/client";
import { RoundStatus, GameStatus } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/utils/types";
import {
  swissPairings,
  arenaPairings,
  roundRobinSchedule,
  knockoutFirstRound,
  knockoutNextRound,
  computeTiebreaks,
  type PlayerState,
  type Pairing,
  type Color,
  type ResultRecord,
} from "./pairing";

type Format = "ARENA" | "SWISS" | "ROUND_ROBIN" | "KNOCKOUT";
const FORMATS: Format[] = ["ARENA", "SWISS", "ROUND_ROBIN", "KNOCKOUT"];

function normalizeFormat(f: string | null | undefined): Format {
  const up = (f ?? "ARENA").toUpperCase().replace(/[\s-]/g, "_") as Format;
  return FORMATS.includes(up) ? up : "ARENA";
}

/** Winner userId of a finished pairing (null = draw / unfinished). */
function winnerOf(p: { whiteUserId: string | null; blackUserId: string | null; result: string | null }): string | null {
  if (p.result === "bye") return p.whiteUserId;
  if (p.result === "1-0") return p.whiteUserId;
  if (p.result === "0-1") return p.blackUserId;
  return null;
}

/**
 * Round + pairing engine wired to the DB. Drives SWISS / ARENA / ROUND_ROBIN /
 * KNOCKOUT: generate the next round's pairings, record board results, compute
 * standings with tiebreaks, and finalize.
 */
export class TournamentRoundService {
  constructor(private prisma: PrismaClient) {}

  private async loadStates(tournamentId: string): Promise<
    { participant: { id: string; userId: string; score: number; byes: number }; state: PlayerState }[]
  > {
    const parts = await this.prisma.tournamentParticipant.findMany({
      where: { tournamentId, withdrawn: false },
      include: { user: { select: { id: true, rating: true } } },
    });
    return parts.map((p) => ({
      participant: { id: p.id, userId: p.userId, score: p.score, byes: p.byes },
      state: {
        userId: p.userId,
        rating: p.user.rating,
        score: p.score,
        colorHistory: (p.colorHistory as Color[]) ?? [],
        opponentIds: p.opponentIds ?? [],
        byes: p.byes,
      },
    }));
  }

  private pairingsFor(
    format: Format,
    states: PlayerState[],
    currentRound: number,
    prevWinners: PlayerState[]
  ): Pairing[] {
    switch (format) {
      case "SWISS":
        return swissPairings(states);
      case "ARENA":
        return arenaPairings(states);
      case "ROUND_ROBIN": {
        const schedule = roundRobinSchedule(states.map((s) => s.userId));
        const round = schedule[currentRound] ?? [];
        // schedule uses userIds directly; bye rows already have blackUserId null.
        return round;
      }
      case "KNOCKOUT":
        return currentRound === 0 ? knockoutFirstRound(states) : knockoutNextRound(prevWinners);
      default:
        return swissPairings(states);
    }
  }

  /** Generate + persist the next round's pairings and update each player's pairing state. */
  async startRound(tournamentId: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new NotFoundError("Tournament not found");
    if (t.status === "COMPLETED" || t.status === "CANCELLED") {
      throw new ValidationError("Tournament is already finished");
    }

    const format = normalizeFormat(t.format);
    const loaded = await this.loadStates(tournamentId);
    if (loaded.length < 2) throw new ValidationError("Need at least 2 players to pair a round");
    const states = loaded.map((l) => l.state);
    const stateById = new Map(states.map((s) => [s.userId, s]));

    // Knockout needs the previous round's winners in board order.
    let prevWinners: PlayerState[] = [];
    if (format === "KNOCKOUT" && t.currentRound > 0) {
      const prev = await this.prisma.tournamentRound.findFirst({
        where: { tournamentId, number: t.currentRound },
        include: { pairings: { orderBy: { boardNumber: "asc" } } },
      });
      if (prev && prev.status !== "COMPLETED") {
        throw new ValidationError("Finish the current round before starting the next");
      }
      prevWinners = (prev?.pairings ?? [])
        .map((p) => winnerOf(p))
        .filter((id): id is string => !!id)
        .map((id) => stateById.get(id))
        .filter((s): s is PlayerState => !!s);
      if (prevWinners.length < 2) throw new ValidationError("Knockout is complete — only a champion remains");
    }

    const pairings = this.pairingsFor(format, states, t.currentRound, prevWinners);
    if (pairings.length === 0) throw new ValidationError("No pairings could be generated");

    const roundNumber = t.currentRound + 1;
    const round = await this.prisma.tournamentRound.create({
      data: { tournamentId, number: roundNumber, status: RoundStatus.ONGOING, startedAt: new Date() },
    });

    // Time control for the live games (must be "min+inc"); fall back to 10+0.
    const timeControl = /^\d+\+\d+$/.test(t.arenaTimeControl) ? t.arenaTimeControl : "10+0";

    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < pairings.length; i++) {
          const pr = pairings[i];
          const isBye = pr.blackUserId === null;

          // For every real board, create a playable live game and link it to the
          // pairing. Players open it at /game/<id> and play on the site; the
          // result flows back automatically via recordGameResult → syncGameResult.
          // (Byes get no game. A no-show can still be settled manually in the
          //  console as an override.)
          let gameId: string | null = null;
          if (!isBye) {
            const game = await tx.game.create({
              data: {
                whiteId: pr.whiteUserId,
                blackId: pr.blackUserId!,
                timeControl,
                tournamentId,
                rated: t.isRated,
                whiteRating: stateById.get(pr.whiteUserId)?.rating ?? null,
                blackRating: stateById.get(pr.blackUserId!)?.rating ?? null,
                moves: "",
                status: GameStatus.PENDING,
              },
            });
            gameId = game.id;
          }

          await tx.tournamentPairing.create({
            data: {
              roundId: round.id,
              tournamentId,
              boardNumber: i + 1,
              whiteUserId: pr.whiteUserId,
              blackUserId: pr.blackUserId,
              gameId,
              result: isBye ? "bye" : null,
            },
          });

          // White player's pairing state.
          const white = loaded.find((l) => l.participant.userId === pr.whiteUserId);
          if (white) {
            await tx.tournamentParticipant.update({
              where: { id: white.participant.id },
              data: isBye
                ? {
                    byes: { increment: 1 },
                    // A bye is worth a full point in Swiss/Arena/Round-Robin (not Knockout).
                    score: format === "KNOCKOUT" ? undefined : { increment: 1 },
                    colorHistory: { push: "w" },
                  }
                : { colorHistory: { push: "w" }, opponentIds: { push: pr.blackUserId! } },
            });
          }
          if (!isBye) {
            const black = loaded.find((l) => l.participant.userId === pr.blackUserId);
            if (black) {
              await tx.tournamentParticipant.update({
                where: { id: black.participant.id },
                data: { colorHistory: { push: "b" }, opponentIds: { push: pr.whiteUserId } },
              });
            }
          }
        }

        await tx.tournament.update({
          where: { id: tournamentId },
          data: { currentRound: roundNumber, status: "ONGOING" },
        });
      },
      { timeout: 20000 }
    );
    return this.getRound(round.id);
  }

  getRound(roundId: string) {
    return this.prisma.tournamentRound.findUnique({
      where: { id: roundId },
      include: { pairings: { orderBy: { boardNumber: "asc" } } },
    });
  }

  listRounds(tournamentId: string) {
    return this.prisma.tournamentRound.findMany({
      where: { tournamentId },
      include: { pairings: { orderBy: { boardNumber: "asc" } } },
      orderBy: { number: "asc" },
    });
  }

  /** Record a board result ("1-0" | "0-1" | "1/2-1/2") and apply the score deltas. */
  async recordResult(pairingId: string, result: string) {
    const valid = ["1-0", "0-1", "1/2-1/2"];
    if (!valid.includes(result)) throw new ValidationError("Result must be 1-0, 0-1, or 1/2-1/2");
    const pairing = await this.prisma.tournamentPairing.findUnique({ where: { id: pairingId } });
    if (!pairing) throw new NotFoundError("Pairing not found");
    if (pairing.result === "bye") throw new ValidationError("Cannot set a result on a bye");
    if (!pairing.whiteUserId || !pairing.blackUserId) throw new ValidationError("Incomplete pairing");

    const whiteDelta = result === "1-0" ? 1 : result === "1/2-1/2" ? 0.5 : 0;
    const blackDelta = result === "0-1" ? 1 : result === "1/2-1/2" ? 0.5 : 0;
    // If a result already existed, reverse it first.
    const prevW = pairing.result === "1-0" ? 1 : pairing.result === "1/2-1/2" ? 0.5 : 0;
    const prevB = pairing.result === "0-1" ? 1 : pairing.result === "1/2-1/2" ? 0.5 : 0;

    await this.prisma.$transaction([
      this.prisma.tournamentPairing.update({ where: { id: pairingId }, data: { result } }),
      this.prisma.tournamentParticipant.updateMany({
        where: { tournamentId: pairing.tournamentId, userId: pairing.whiteUserId },
        data: { score: { increment: whiteDelta - prevW } },
      }),
      this.prisma.tournamentParticipant.updateMany({
        where: { tournamentId: pairing.tournamentId, userId: pairing.blackUserId },
        data: { score: { increment: blackDelta - prevB } },
      }),
    ]);
    return this.prisma.tournamentPairing.findUnique({ where: { id: pairingId } });
  }

  /**
   * A linked live game finished on the gameplay server → record its result on
   * the pairing and auto-complete the round once every board is in. Idempotent
   * (recordResult reverses any prior result first). Called from the
   * recordGameResult resolver after the game is marked COMPLETED.
   */
  async syncGameResult(gameId: string, gameResult: string) {
    const pairing = await this.prisma.tournamentPairing.findFirst({ where: { gameId } });
    if (!pairing || pairing.result === "bye") return null;
    const map: Record<string, string> = {
      WHITE_WIN: "1-0",
      BLACK_WIN: "0-1",
      DRAW: "1/2-1/2",
      STALEMATE: "1/2-1/2",
    };
    const r = map[gameResult];
    if (!r) return null; // aborted/void game — leave the board open for a manual call
    await this.recordResult(pairing.id, r);
    await this.maybeCompleteRound(pairing.roundId);
    return pairing.id;
  }

  /** Auto-complete a round once every board has a result. */
  private async maybeCompleteRound(roundId: string) {
    const round = await this.prisma.tournamentRound.findUnique({
      where: { id: roundId },
      include: { pairings: true },
    });
    if (!round || round.status === "COMPLETED") return;
    if (round.pairings.every((p) => !!p.result)) {
      await this.prisma.tournamentRound.update({
        where: { id: roundId },
        data: { status: RoundStatus.COMPLETED, completedAt: new Date() },
      });
    }
  }

  async completeRound(roundId: string) {
    const round = await this.prisma.tournamentRound.findUnique({
      where: { id: roundId },
      include: { pairings: true },
    });
    if (!round) throw new NotFoundError("Round not found");
    const unfinished = round.pairings.filter((p) => !p.result);
    if (unfinished.length) {
      throw new ValidationError(`${unfinished.length} board(s) still need a result`);
    }
    return this.prisma.tournamentRound.update({
      where: { id: roundId },
      data: { status: RoundStatus.COMPLETED, completedAt: new Date() },
    });
  }

  /** All recorded results as per-player records (for tiebreaks). */
  private async resultRecords(tournamentId: string): Promise<ResultRecord[]> {
    const pairings = await this.prisma.tournamentPairing.findMany({
      where: { tournamentId, result: { not: null } },
    });
    const recs: ResultRecord[] = [];
    for (const p of pairings) {
      if (!p.whiteUserId || !p.blackUserId || p.result === "bye") continue;
      const w = p.result === "1-0" ? 1 : p.result === "1/2-1/2" ? 0.5 : 0;
      recs.push({ userId: p.whiteUserId, opponentId: p.blackUserId, score: w });
      recs.push({ userId: p.blackUserId, opponentId: p.whiteUserId, score: 1 - w });
    }
    return recs;
  }

  /** Standings sorted by score, then Buchholz, then Sonneborn-Berger, then rating. */
  async standings(tournamentId: string) {
    const parts = await this.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      include: { user: { select: { id: true, username: true, rating: true } } },
    });
    const tb = computeTiebreaks(
      parts.map((p) => ({ userId: p.userId, score: p.score })),
      await this.resultRecords(tournamentId)
    );
    return parts
      .map((p) => {
        const t = tb.get(p.userId) ?? { buchholz: 0, sonnebornBerger: 0 };
        return {
          userId: p.userId,
          username: p.user.username,
          rating: p.user.rating,
          score: p.score,
          buchholz: t.buchholz,
          sonnebornBerger: t.sonnebornBerger,
          byes: p.byes,
          withdrawn: p.withdrawn,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.buchholz - a.buchholz ||
          b.sonnebornBerger - a.sonnebornBerger ||
          b.rating - a.rating
      )
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }

  /** Persist final tiebreaks on participants and mark the tournament complete. */
  async finalize(tournamentId: string) {
    const standings = await this.standings(tournamentId);
    await this.prisma.$transaction([
      ...standings.map((s) =>
        this.prisma.tournamentParticipant.updateMany({
          where: { tournamentId, userId: s.userId },
          data: { buchholz: s.buchholz, sonnebornBerger: s.sonnebornBerger },
        })
      ),
      this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { status: "COMPLETED", endDate: new Date() },
      }),
    ]);
    return this.standings(tournamentId);
  }
}

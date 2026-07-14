/**
 * Engine resolvers — server-side chess engine.
 *
 * Strong bots (elo >= STOCKFISH_MIN_ELO) proxy to the CCA backend on Render,
 * which runs real Stockfish 18 with UCI_Elo. The local pure-JS negamax tops
 * out around ~1700 regardless of the label, which made high-rated bots play
 * far below their advertised strength. Weak bots stay on the local JS engine:
 * it's fast, tuned for beatable play, and Stockfish can't go below UCI_Elo
 * 1320 anyway. If the proxy fails or times out (e.g. Render cold start), we
 * fall back to the local JS engine so a bot move is never dropped.
 */
import { GraphQLError } from "graphql";
import { getBestMoveJS, getEvaluationJS } from "../../lib/jsChessEngine";

const STOCKFISH_MIN_ELO = 1500;
const STOCKFISH_TIMEOUT_MS = 7000;
const STOCKFISH_URL =
  process.env.CCA_ENGINE_GRAPHQL_URL ?? "https://live.dchessacademy.com/graphql";

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Best move from the CCA Stockfish service, or null on any failure. */
async function stockfishBestMove(fen: string, elo: number): Promise<string | null> {
  try {
    const res = await fetch(STOCKFISH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "query($fen:String!,$elo:Int){ engineBestMove(fen:$fen, elo:$elo) }",
        variables: { fen, elo },
      }),
      signal: AbortSignal.timeout(STOCKFISH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { engineBestMove?: string | null } };
    const move = json?.data?.engineBestMove;
    return typeof move === "string" && UCI_MOVE.test(move) ? move : null;
  } catch {
    return null;
  }
}

const FEN_SHAPE = /^[1-8pnbrqkPNBRQK/]+ [wb] [KQkqA-Ha-h-]+ (-|[a-h][1-8]) \d+ \d+$/;

function validateFen(fen: string): string {
  const trimmed = fen?.trim();
  if (!trimmed || !FEN_SHAPE.test(trimmed)) {
    throw new GraphQLError("Invalid FEN", { extensions: { code: "BAD_USER_INPUT" } });
  }
  return trimmed;
}

export const engineResolvers = {
  Query: {
    engineBestMove: async (
      _: unknown,
      { fen, elo }: { fen: string; elo?: number | null },
    ): Promise<string | null> => {
      const f = validateFen(fen);
      const strength = elo ?? 1600;
      if (strength >= STOCKFISH_MIN_ELO) {
        const move = await stockfishBestMove(f, strength);
        if (move) return move;
      }
      try {
        return getBestMoveJS(f, strength);
      } catch (err) {
        throw new GraphQLError(
          err instanceof Error ? `Engine error: ${err.message}` : "Engine error",
          { extensions: { code: "ENGINE_ERROR" } },
        );
      }
    },

    engineEvaluation: async (
      _: unknown,
      { fen }: { fen: string },
    ): Promise<{ cp: number | null; mate: number | null }> => {
      const f = validateFen(fen);
      try {
        return getEvaluationJS(f);
      } catch (err) {
        throw new GraphQLError(
          err instanceof Error ? `Engine error: ${err.message}` : "Engine error",
          { extensions: { code: "ENGINE_ERROR" } },
        );
      }
    },
  },
};

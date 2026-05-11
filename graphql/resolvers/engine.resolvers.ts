/**
 * Engine resolvers — server-side chess engine. Pure-JS negamax (no
 * native Stockfish on Vercel functions). Identical to the engine the
 * browser uses as its local fallback, so client + server play the same
 * game when the WASM Stockfish isn't available.
 */
import { GraphQLError } from "graphql";
import { getBestMoveJS, getEvaluationJS } from "../../lib/jsChessEngine";

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
      try {
        return getBestMoveJS(f, elo ?? 1600);
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

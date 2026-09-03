import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import { passed } from "@/domains/learning/ladder";

/**
 * The ladder — the app's tiered curriculum, attached to an account.
 *
 * Three operations, all of which read the caller's id from the token and none
 * of which take one as an argument. That is the access rule, and it is
 * enforced by there being no way to express the other thing.
 */
export const ladderResolvers = {
  Query: {
    myLadderProgress: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices,
    ) => {
      return context.services.ladderService.progressFor(requireUser(context));
    },
  },

  Mutation: {
    recordLadderLessons: async (
      _: unknown,
      { lessons }: {
        lessons: Array<{ lessonId: string; tierId: string; completedAt: Date }>;
      },
      context: GraphQLContextWithServices,
    ) => {
      return context.services.ladderService.recordLessons(
        requireUser(context),
        lessons,
      );
    },

    recordLadderExam: async (
      _: unknown,
      { input }: {
        input: {
          attemptId: string;
          examId: string;
          tierId: string;
          scorePoints: number;
          maxPoints: number;
          startedAt: Date;
          finishedAt: Date;
        };
      },
      context: GraphQLContextWithServices,
    ) => {
      return context.services.ladderService.recordExam(
        requireUser(context),
        input,
      );
    },
  },

  /**
   * `passed` is not a column. It is `grade !== FAIL`, computed by the same
   * function the service grades with — so a row can never say PASS and
   * `passed: false`, which is exactly what storing both would eventually
   * allow.
   */
  LadderExamResult: {
    passed: (row: { grade: "FAIL" | "PASS" | "GOOD" | "EXCELLENT" }) =>
      passed(row.grade),
  },
};

function requireUser(context: GraphQLContextWithServices): string {
  if (!context.user) {
    throw new GraphQLError("Not authenticated", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return context.user.userId;
}

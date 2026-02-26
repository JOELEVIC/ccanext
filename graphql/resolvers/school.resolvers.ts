import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";

export const schoolResolvers = {
  Query: {
    school: async (
      _: unknown,
      { id }: { id: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.institutionService.getSchoolById(id);
    },

    schools: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices
    ) => {
      return context.services.institutionService.getAllSchools();
    },

    schoolsByRegion: async (
      _: unknown,
      { region }: { region: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.institutionService.getSchoolsByRegion(region);
    },

    schoolLeaderboard: async (
      _: unknown,
      { schoolId }: { schoolId: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.institutionService.getSchoolLeaderboard(schoolId);
    },

    schoolStats: async (
      _: unknown,
      { schoolId }: { schoolId: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.institutionService.getSchoolStats(schoolId);
    },
  },

  Mutation: {
    createSchool: async (
      _: unknown,
      { input }: { input: { name: string; region: string } },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.institutionService.createSchool(input);
    },
  },

  School: {
    students: (parent: { students?: unknown }) => parent.students ?? [],
    tournaments: (parent: { tournaments?: unknown }) => parent.tournaments ?? [],
  },
};

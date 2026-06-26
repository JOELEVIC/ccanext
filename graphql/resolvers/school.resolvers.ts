import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";

function requireAdmin(ctx: GraphQLContextWithServices) {
  if (!ctx.admin) {
    throw new GraphQLError("Admin authentication required", {
      extensions: { code: "ADMIN_UNAUTHENTICATED" },
    });
  }
}

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

    // Admin school management (admin token; players never reach these).
    adminCreateSchool: async (
      _: unknown,
      { input }: { input: { name: string; region: string } },
      context: GraphQLContextWithServices
    ) => {
      requireAdmin(context);
      return context.services.institutionService.createSchool(input);
    },

    adminUpdateSchool: async (
      _: unknown,
      { id, input }: { id: string; input: { name?: string; region?: string } },
      context: GraphQLContextWithServices
    ) => {
      requireAdmin(context);
      return context.services.institutionService.updateSchool(id, input);
    },
  },

  School: {
    students: (parent: { students?: unknown }) => parent.students ?? [],
    tournaments: (parent: { tournaments?: unknown }) => parent.tournaments ?? [],
  },
};

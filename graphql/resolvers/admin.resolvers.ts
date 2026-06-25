import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";

/** Require a valid admin token (separate from player auth). */
function requireAdmin(context: GraphQLContextWithServices) {
  if (!context.admin) {
    throw new GraphQLError("Admin authentication required", {
      extensions: { code: "ADMIN_UNAUTHENTICATED" },
    });
  }
  return context.admin;
}

export const adminResolvers = {
  Query: {
    // Returns null (not an error) when unauthenticated, so the admin app can
    // probe session state on load.
    adminMe: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      if (!context.admin) return null;
      return context.services.adminService.me(context.admin.adminId);
    },

    adminOverview: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      const admin = requireAdmin(context);
      return context.services.adminService.getOverview(admin.adminId);
    },

    adminUsers: async (
      _: unknown,
      args: { search?: string; limit?: number; offset?: number },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return context.services.adminService.listUsers(admin.adminId, args);
    },

    adminUser: async (
      _: unknown,
      { userId }: { userId: string },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return context.services.adminService.getUserDetail(admin.adminId, userId);
    },

    adminAdmins: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      const admin = requireAdmin(context);
      return context.services.adminService.listAdmins(admin.adminId);
    },
  },

  Mutation: {
    adminLogin: async (
      _: unknown,
      { email, password }: { email: string; password: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.adminService.login(email, password);
    },

    adminAddAdmin: async (
      _: unknown,
      { email }: { email: string },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return context.services.adminService.addAdmin(admin.adminId, email);
    },

    adminRemoveAdmin: async (
      _: unknown,
      { adminId }: { adminId: string },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return context.services.adminService.removeAdmin(admin.adminId, adminId);
    },

    adminTriggerPlacement: async (
      _: unknown,
      { userId }: { userId: string },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return context.services.adminService.triggerPlacement(admin.adminId, userId);
    },

    adminOverrideRating: async (
      _: unknown,
      { userId, rating }: { userId: string; rating: number },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return context.services.adminService.overrideRating(admin.adminId, userId, rating);
    },
  },
};

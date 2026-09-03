import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import { AppError } from "@/utils/types";

/** Require a valid admin token (separate from player auth). */
function requireAdmin(context: GraphQLContextWithServices) {
  if (!context.admin) {
    throw new GraphQLError("Admin authentication required", {
      extensions: { code: "ADMIN_UNAUTHENTICATED" },
    });
  }
  return context.admin;
}

/**
 * Surface service errors as real GraphQL errors. The domain services throw
 * AppError subclasses (AuthenticationError, ValidationError, …); without this,
 * graphql-yoga masks them as a generic "Unexpected error.". Rethrowing as a
 * GraphQLError keeps the message + code (e.g. "Invalid credentials").
 */
async function adminCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GraphQLError) throw e;
    if (e instanceof AppError) {
      throw new GraphQLError(e.message, { extensions: { code: e.code ?? "ADMIN_ERROR" } });
    }
    throw e;
  }
}

export const adminResolvers = {
  Query: {
    /**
     * Clubs, from the staff console.
     *
     * The one list in the product that carries `joinCode`, which is why it is
     * here behind the admin token rather than anywhere a player can reach.
     */
    adminClubs: async (
      _: unknown,
      args: { search?: string; limit?: number; offset?: number },
      context: GraphQLContextWithServices
    ) => {
      requireAdmin(context);
      return adminCall(() => context.services.clubAdminService.list(args));
    },

    // Returns null (not an error) when unauthenticated, so the admin app can
    // probe session state on load.
    adminMe: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      if (!context.admin) return null;
      return adminCall(() => context.services.adminService.me(context.admin!.adminId));
    },

    // Step 1 of login — unauthenticated; decides set-password vs password prompt.
    adminAuthStage: async (
      _: unknown,
      { email }: { email: string },
      context: GraphQLContextWithServices
    ) => {
      return adminCall(() => context.services.adminService.authStage(email));
    },

    adminOverview: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      const admin = requireAdmin(context);
      return adminCall(() => context.services.adminService.getOverview(admin.adminId));
    },

    adminUsers: async (
      _: unknown,
      args: { search?: string; limit?: number; offset?: number },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return adminCall(() => context.services.adminService.listUsers(admin.adminId, args));
    },

    adminUser: async (
      _: unknown,
      { userId }: { userId: string },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return adminCall(() => context.services.adminService.getUserDetail(admin.adminId, userId));
    },

    adminAdmins: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      const admin = requireAdmin(context);
      return adminCall(() => context.services.adminService.listAdmins(admin.adminId));
    },
  },

  Mutation: {
    adminCreateClub: async (
      _: unknown,
      { input }: { input: Parameters<
        GraphQLContextWithServices["services"]["clubAdminService"]["create"]
      >[0] },
      context: GraphQLContextWithServices
    ) => {
      requireAdmin(context);
      return adminCall(() => context.services.clubAdminService.create(input));
    },

    adminSetClubPatron: async (
      _: unknown,
      { clubId, username }: { clubId: string; username: string },
      context: GraphQLContextWithServices
    ) => {
      requireAdmin(context);
      return adminCall(() =>
        context.services.clubAdminService.setPatron(clubId, username)
      );
    },

    adminRegenerateJoinCode: async (
      _: unknown,
      { clubId }: { clubId: string },
      context: GraphQLContextWithServices
    ) => {
      requireAdmin(context);
      return adminCall(() =>
        context.services.clubAdminService.regenerateJoinCode(clubId)
      );
    },

    adminSetClubStatus: async (
      _: unknown,
      { clubId, status }: { clubId: string; status: "ONBOARDING" | "ACTIVE" | "DORMANT" | "ARCHIVED" },
      context: GraphQLContextWithServices
    ) => {
      requireAdmin(context);
      return adminCall(() =>
        context.services.clubAdminService.setStatus(clubId, status)
      );
    },

    adminLogin: async (
      _: unknown,
      { email, password }: { email: string; password: string },
      context: GraphQLContextWithServices
    ) => {
      return adminCall(() => context.services.adminService.login(email, password));
    },

    adminAddAdmin: async (
      _: unknown,
      { email }: { email: string },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return adminCall(() => context.services.adminService.addAdmin(admin.adminId, email));
    },

    adminRemoveAdmin: async (
      _: unknown,
      { adminId }: { adminId: string },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return adminCall(() => context.services.adminService.removeAdmin(admin.adminId, adminId));
    },

    adminTriggerPlacement: async (
      _: unknown,
      { userId }: { userId: string },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return adminCall(() => context.services.adminService.triggerPlacement(admin.adminId, userId));
    },

    adminOverrideRating: async (
      _: unknown,
      { userId, rating }: { userId: string; rating: number },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return adminCall(() =>
        context.services.adminService.overrideRating(admin.adminId, userId, rating)
      );
    },

    adminUpdateUsername: async (
      _: unknown,
      { userId, username }: { userId: string; username: string },
      context: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(context);
      return adminCall(() =>
        context.services.adminService.updateUsername(admin.adminId, userId, username)
      );
    },
  },
};

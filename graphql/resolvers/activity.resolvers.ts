import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { ActivityInput } from "@/domains/activity/activity.service";

function requireAdmin(ctx: GraphQLContextWithServices) {
  if (!ctx.admin) {
    throw new GraphQLError("Admin authentication required", {
      extensions: { code: "ADMIN_UNAUTHENTICATED" },
    });
  }
  return ctx.admin;
}

interface GqlActivityInput extends Omit<ActivityInput, "bodyJson"> {
  bodyJson?: string | null; // JSON string over the wire
}

/** Parse the incoming bodyJson string into an object for the service. */
function normalize(input: GqlActivityInput): ActivityInput {
  let bodyJson: unknown;
  if (input.bodyJson) {
    try {
      bodyJson = JSON.parse(input.bodyJson);
    } catch {
      throw new GraphQLError("bodyJson must be valid JSON");
    }
  }
  return { ...input, bodyJson };
}

export const activityResolvers = {
  Query: {
    activities: (
      _: unknown,
      args: { type?: string; region?: string; limit?: number; offset?: number },
      ctx: GraphQLContextWithServices
    ) => ctx.services.activityService.getFeed(args),

    activity: (_: unknown, { slug }: { slug: string }, ctx: GraphQLContextWithServices) =>
      ctx.services.activityService.getPublishedBySlug(slug),

    adminActivities: (
      _: unknown,
      args: { status?: string; search?: string; limit?: number; offset?: number },
      ctx: GraphQLContextWithServices
    ) => {
      requireAdmin(ctx);
      return ctx.services.activityService.adminList(args);
    },

    adminActivity: (_: unknown, { id }: { id: string }, ctx: GraphQLContextWithServices) => {
      requireAdmin(ctx);
      return ctx.services.activityService.adminGet(id);
    },
  },

  Mutation: {
    adminCreateActivity: (
      _: unknown,
      { input }: { input: GqlActivityInput },
      ctx: GraphQLContextWithServices
    ) => {
      const admin = requireAdmin(ctx);
      return ctx.services.activityService.create(normalize(input), admin.adminId);
    },

    adminUpdateActivity: (
      _: unknown,
      { id, input }: { id: string; input: GqlActivityInput },
      ctx: GraphQLContextWithServices
    ) => {
      requireAdmin(ctx);
      return ctx.services.activityService.update(id, normalize(input));
    },

    adminPublishActivity: (_: unknown, { id }: { id: string }, ctx: GraphQLContextWithServices) => {
      requireAdmin(ctx);
      return ctx.services.activityService.publish(id);
    },

    adminUnpublishActivity: (_: unknown, { id }: { id: string }, ctx: GraphQLContextWithServices) => {
      requireAdmin(ctx);
      return ctx.services.activityService.unpublish(id);
    },

    adminArchiveActivity: (_: unknown, { id }: { id: string }, ctx: GraphQLContextWithServices) => {
      requireAdmin(ctx);
      return ctx.services.activityService.archive(id);
    },

    adminDeleteActivity: (_: unknown, { id }: { id: string }, ctx: GraphQLContextWithServices) => {
      requireAdmin(ctx);
      return ctx.services.activityService.remove(id);
    },
  },

  Activity: {
    // Stored as JSONB; expose to clients as a JSON string (no JSON scalar in this schema).
    bodyJson: (parent: { bodyJson?: unknown }) =>
      parent.bodyJson == null ? null : JSON.stringify(parent.bodyJson),
  },
};

import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { ActivityInput } from "@/domains/activity/activity.service";
import { normalizeRegion } from "@/domains/region/regions";

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
  // New posts are written with a canonical region key, so the one-off
  // normalisation in prisma/manual_apply_clubs_seasons.sql section 12 stays a
  // one-off rather than something that has to be re-run after every article.
  const region = input.region ? normalizeRegion(input.region) ?? input.region : input.region;
  return { ...input, bodyJson, region };
}

export const activityResolvers = {
  Query: {
    activities: (
      _: unknown,
      args: { clubId?: string; type?: string; region?: string; limit?: number; offset?: number },
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

    // Every repository read includes `images` ordered by sortOrder, so these
    // derive from the loaded relation instead of issuing extra queries.
    highlights: (parent: { images?: { highlight?: boolean }[] }) => {
      const imgs = parent.images ?? [];
      const flagged = imgs.filter((img) => img.highlight);
      // Un-curated galleries still get a collage: fall back to the first images.
      return (flagged.length ? flagged : imgs).slice(0, 12);
    },

    photoCount: (parent: { images?: unknown[] }) => parent.images?.length ?? 0,
  },
};

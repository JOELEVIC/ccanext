import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { EnquiryStatus } from "@prisma/client";
import type { SchoolEnquiryInput } from "@/domains/enquiry/enquiry.service";

function requireStaff(ctx: GraphQLContextWithServices) {
  if (!ctx.admin) {
    throw new GraphQLError("Admin authentication required", {
      extensions: { code: "ADMIN_UNAUTHENTICATED" },
    });
  }
  return ctx.admin;
}

/**
 * School intake (BUILD_PLAN §6).
 *
 * `submitSchoolEnquiry` is the only public unauthenticated WRITE in the Phase 1
 * surface. The honeypot, the IP throttle and the phone throttle all live in
 * `EnquiryService`; the resolver's only job is to hand over the caller's IP,
 * which the service immediately hashes.
 */
export const enquiryResolvers = {
  Query: {
    schoolEnquiries: (
      _: unknown,
      args: { status?: EnquiryStatus | null; limit?: number | null; offset?: number | null },
      ctx: GraphQLContextWithServices
    ) => {
      requireStaff(ctx);
      return ctx.services.enquiryService.list(args);
    },
  },

  Mutation: {
    submitSchoolEnquiry: (
      _: unknown,
      { input }: { input: SchoolEnquiryInput },
      ctx: GraphQLContextWithServices
    ) => ctx.services.enquiryService.submit(input, { ip: ctx.clientIp }),

    adminUpdateSchoolEnquiryStatus: (
      _: unknown,
      { id, status }: { id: string; status: EnquiryStatus },
      ctx: GraphQLContextWithServices
    ) => {
      requireStaff(ctx);
      return ctx.prisma.schoolEnquiry.update({ where: { id }, data: { status } });
    },
  },
};

import { createYoga } from "graphql-yoga";

export const dynamic = "force-dynamic";
import { schema } from "@/graphql/schema";
import { buildContext } from "@/graphql/context";
import { config } from "@/config/env";

const { handleRequest } = createYoga({
  schema,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Request, Response },
  context: async ({ request }) => buildContext(request),
  cors: {
    origin: config.cors.origin.split(",").map((o) => o.trim()).filter(Boolean),
    credentials: true,
    // `Apollo-Require-Preflight` is required by Apollo Server's CSRF protection
    // and the cross-site UI must be allowed to send it. Without it on the
    // allow-list, browsers abort the preflight and no GraphQL call goes out.
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Apollo-Require-Preflight",
      "X-Apollo-Operation-Name",
    ],
  },
});

export { handleRequest as GET, handleRequest as POST, handleRequest as OPTIONS };

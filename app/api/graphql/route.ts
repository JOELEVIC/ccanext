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
    origin: config.cors.origin,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

export { handleRequest as GET, handleRequest as POST, handleRequest as OPTIONS };

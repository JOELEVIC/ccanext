import { createYoga } from "graphql-yoga";

export const dynamic = "force-dynamic";
import { schema } from "@/graphql/schema";
import { buildContext } from "@/graphql/context";

const { handleRequest } = createYoga({
  schema,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Request, Response },
  context: async ({ request }) => buildContext(request),
});

export { handleRequest as GET, handleRequest as POST };

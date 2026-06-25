import { createYoga } from "graphql-yoga";

export const dynamic = "force-dynamic";
import { schema } from "@/graphql/schema";
import { buildContext } from "@/graphql/context";
import { config } from "@/config/env";

const ENV_ORIGINS = config.cors.origin
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// The admin dashboard runs on a hard-to-guess subdomain. Allow any
// admin.<secret>.dchessacademy.com so the secret itself never needs to live in
// this (potentially shared) repo. Main-site origins still come from CORS_ORIGIN.
const ADMIN_ORIGIN_RE = /^https:\/\/admin\.[a-z0-9-]+\.dchessacademy\.com$/;

function corsOriginFor(request: Request): string[] {
  const origin = request.headers.get("origin");
  if (origin && (ENV_ORIGINS.includes(origin) || ADMIN_ORIGIN_RE.test(origin))) {
    return [origin];
  }
  return ENV_ORIGINS;
}

const { handleRequest } = createYoga({
  schema,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Request, Response },
  context: async ({ request }) => buildContext(request),
  // Function form so the allow-list can include the admin subdomain by pattern.
  cors: (request) => ({
    origin: corsOriginFor(request),
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
  }),
});

export { handleRequest as GET, handleRequest as POST, handleRequest as OPTIONS };

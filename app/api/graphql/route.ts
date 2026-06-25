import { createYoga } from "graphql-yoga";
import { GraphQLError } from "graphql";

export const dynamic = "force-dynamic";
import { schema } from "@/graphql/schema";
import { buildContext } from "@/graphql/context";
import { config } from "@/config/env";
import { AppError } from "@/utils/types";

/** The AppError behind a thrown error, if any (yoga may wrap it as `originalError`). */
function unwrapAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;
  const orig = (error as { originalError?: unknown } | null | undefined)?.originalError;
  return orig instanceof AppError ? orig : null;
}

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
  // Domain services throw AppError subclasses (AuthenticationError, ValidationError, …)
  // for expected, user-facing failures — e.g. "Invalid email or password" or
  // "Email already in use". Surface those verbatim (with their code) instead of
  // yoga's generic "Unexpected error."; everything else stays masked so internal
  // details never leak.
  maskedErrors: {
    maskError(error, message) {
      const appErr = unwrapAppError(error);
      if (appErr) {
        return new GraphQLError(appErr.message, { extensions: { code: appErr.code ?? "BAD_USER_INPUT" } });
      }
      // Preserve intentionally-thrown GraphQLErrors (e.g. "Not authenticated"); mask the rest.
      if (error instanceof GraphQLError && (error.originalError == null || error.originalError instanceof GraphQLError)) {
        return error;
      }
      return new GraphQLError(message);
    },
  },
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

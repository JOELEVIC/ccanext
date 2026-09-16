import "dotenv/config";
import { z } from "zod";
import { redactDatabaseUrl } from "@/utils/redact";

// On Vercel, NODE_ENV is set by the platform; default to production so we never run as development
const defaultNodeEnv = process.env.VERCEL ? "production" : "development";
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default(defaultNodeEnv),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  // Admin-panel auth uses a separate signing key so admin tokens and player tokens
  // can never validate against each other. Optional: if unset we derive a distinct
  // key from JWT_SECRET (works out of the box; set a dedicated value in prod).
  ADMIN_JWT_SECRET: z.string().min(32).optional(),
  ADMIN_JWT_EXPIRES_IN: z.string().default("12h"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY is required"),
  // Server-only key used to write to Storage (bypasses RLS). Optional so the app
  // still boots without it; the admin image-upload route returns a clear error
  // when it's missing. Never expose this to the browser.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // Public Storage bucket that holds activity/event media (images).
  SUPABASE_MEDIA_BUCKET: z.string().default("activity-media"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /**
   * Comma-separated OAuth client ids whose Google ID tokens `loginWithGoogle`
   * will accept as `aud`. Optional: unset, `domains/auth/googleVerify.ts` falls
   * back to the single hardcoded web client, which is exactly how this API
   * behaved before the list existed — so an existing deploy is unaffected.
   *
   * It exists because the platforms disagree about `aud`. Android puts the web
   * client id there (it is what the app passes as `serverClientId`); iOS mints
   * against the iOS client id and cannot sign in at all until that id is here.
   *
   * NOT a secret — every one of these ids ships inside a client binary. It is
   * still the most dangerous variable in this file: every id listed must belong
   * to the SAME Google Cloud project, because `aud` identifies the OAuth client
   * that requested the token and nothing else. An id from an unrelated project
   * turns that project's consent screen into a way of minting tokens this API
   * accepts as identity. See the header of `parseAudienceAllowList`.
   */
  GOOGLE_CLIENT_IDS: z.string().optional(),
  /**
   * Shared with the cca game server, which uses it to mint player sessions
   * for the house players and to poll for seeks nobody has taken. Unset, both
   * operations refuse — the house players simply do not exist. At least 32
   * characters, like every other secret here; it is a bearer credential for
   * accounts that can accept challenges and record game results.
   */
  HOUSE_BOT_SECRET: z.string().min(32).optional(),
});

function parseEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Invalid environment variables:");
      error.issues.forEach((err) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      if (process.env.VERCEL) throw error;
      process.exit(1);
    }
    throw error;
  }
}

const env = parseEnv();

// On Vercel, log redacted DATABASE_URL once so you can verify the correct URL is used (no password).
if (process.env.VERCEL && env.DATABASE_URL) {
  console.info("DATABASE_URL (redacted):", redactDatabaseUrl(env.DATABASE_URL));
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === "development",
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  database: { url: env.DATABASE_URL },
  jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
  adminJwt: {
    // Fall back to a key derived from JWT_SECRET so admin auth works without extra
    // config; the distinct suffix means admin tokens never validate as player tokens.
    secret: env.ADMIN_JWT_SECRET ?? `${env.JWT_SECRET}::admin`,
    expiresIn: env.ADMIN_JWT_EXPIRES_IN,
  },
  supabase: {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    mediaBucket: env.SUPABASE_MEDIA_BUCKET,
  },
  cors: { origin: env.CORS_ORIGIN },
  // Handed to `googleVerify.ts` as the raw string; the splitting, trimming and
  // empty-entry rules live beside the audience check they protect rather than
  // here, so there is one place to read when asking "what would this accept?".
  google: { clientIds: env.GOOGLE_CLIENT_IDS },
  houseBot: { secret: env.HOUSE_BOT_SECRET },
} as const;

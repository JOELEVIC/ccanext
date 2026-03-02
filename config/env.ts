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
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY is required"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
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
  supabase: { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
  cors: { origin: env.CORS_ORIGIN },
} as const;

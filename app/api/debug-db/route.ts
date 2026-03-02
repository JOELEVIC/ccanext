import { NextResponse } from "next/server";
import { config } from "@/config/env";
import { redactDatabaseUrl } from "@/utils/redact";

/**
 * GET /api/debug-db — Returns redacted DATABASE_URL info to verify Vercel env.
 * Only available when VERCEL is set (or in development). Remove or restrict in production.
 */
export async function GET() {
  const url = config.database.url;
  let host = "";
  let user = "";
  try {
    const match = url.match(/^postgresql:\/\/([^:]+):[^@]+@([^/]+)/);
    if (match) {
      user = match[1];
      host = match[2];
    }
  } catch {
    // ignore
  }
  return NextResponse.json({
    databaseUrlRedacted: redactDatabaseUrl(url),
    host,
    user,
    isPooler: host.includes("pooler.supabase.com"),
    vercel: !!process.env.VERCEL,
  });
}

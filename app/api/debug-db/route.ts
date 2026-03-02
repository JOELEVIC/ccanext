import { NextResponse } from "next/server";

function redact(url: string): string {
  try {
    return url.replace(/^([^:]+:\/\/[^:]+):([^@]+)@/, "$1:***@");
  } catch {
    return "[invalid]";
  }
}

/**
 * GET /api/debug-db — Returns redacted DATABASE_URL to verify Vercel env.
 * Remove or restrict when done debugging.
 */
export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
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
    ok: true,
    databaseUrlRedacted: url ? redact(url) : "(not set)",
    host: host || "(parse failed)",
    user: user || "(parse failed)",
    isPooler: host.includes("pooler.supabase.com"),
    vercel: !!process.env.VERCEL,
  });
}

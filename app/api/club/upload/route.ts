// Scoresheet upload for the patron console — PLATFORM_ROADMAP Milestone 4.3.
//
// The sibling of /api/admin/upload, and separate from it for one reason: that
// route requires an ADMIN token, and a patron is not an admin. A patron holds
// an ordinary player JWT plus a role inside one club, which is exactly the
// authority this endpoint checks.
//
// It is scoped to a fixture rather than to "any signed-in user". A photograph
// of a scoresheet is a picture of two named children's handwriting; the person
// uploading one has to be someone entitled to record that fixture's results.
import { config } from "@/config/env";
import { prisma } from "@/lib/prisma";
import { ClubManagementService } from "@/domains/club/management.service";
import { extractTokenFromHeader, verifyToken } from "@/utils/jwt";

export const runtime = "nodejs";

const ENV_ORIGINS = config.cors.origin
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow = origin && ENV_ORIGINS.includes(origin) ? origin : ENV_ORIGINS[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

// Smaller than the admin route's 10MB: this is one phone photograph of one
// sheet of paper, taken at a venue on a connection that may be 3G. A patron
// whose upload silently costs 10MB of their data is a patron who stops.
const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic"];

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "content-type": "application/json" },
    });

  // 1. Who is asking?
  const token = extractTokenFromHeader(req.headers.get("authorization") ?? undefined);
  if (!token) return json({ error: "Sign in to upload a scoresheet" }, 401);

  let userId: string;
  try {
    userId = verifyToken(token).userId;
  } catch {
    return json({ error: "Invalid or expired token" }, 401);
  }

  // 2. Read the file and the fixture it belongs to.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data with 'file' and 'fixtureId'" }, 400);
  }

  const file = form.get("file");
  const fixtureId = form.get("fixtureId");
  if (!(file instanceof File)) return json({ error: "No file provided" }, 400);
  if (typeof fixtureId !== "string" || !fixtureId) {
    return json({ error: "A scoresheet must name the fixture it belongs to" }, 400);
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED.includes(contentType)) {
    return json({ error: `Unsupported image type: ${contentType}` }, 415);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: "A scoresheet photograph must be 6MB or smaller" }, 413);
  }

  // 3. May this person record results for this fixture?
  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    select: { homeClubId: true, awayClubId: true },
  });
  if (!fixture) return json({ error: "Fixture not found" }, 404);

  const management = new ClubManagementService(prisma);
  let permitted = false;
  for (const clubId of [fixture.homeClubId, fixture.awayClubId]) {
    if (!clubId) continue;
    try {
      await management.requireClubAction(userId, clubId, "result:record");
      permitted = true;
      break;
    } catch {
      // Try the other side before refusing.
    }
  }
  if (!permitted) {
    return json({ error: "You do not have permission to do that in this fixture" }, 403);
  }

  // 4. Store it. Same bucket and same service-role path as the admin route —
  // the browser never sees the key.
  const { serviceRoleKey, url: supabaseUrl, mediaBucket } = config.supabase;
  if (!serviceRoleKey) {
    return json({ error: "Uploads are not configured (missing SUPABASE_SERVICE_ROLE_KEY)" }, 500);
  }

  const ext = (file.name.split(".").pop() || contentType.split("/")[1] || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 5);
  const now = new Date();
  const path = `scoresheets/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;

  let up: Response;
  try {
    up = await fetch(`${supabaseUrl}/storage/v1/object/${mediaBucket}/${encodeURI(path)}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "x-upsert": "true",
      },
      body: await file.arrayBuffer(),
    });
  } catch {
    return json({ error: "Could not reach storage backend" }, 502);
  }
  if (!up.ok) {
    const detail = await up.text().catch(() => "");
    return json({ error: `Storage upload failed (${up.status})`, detail: detail.slice(0, 300) }, 502);
  }

  return json({
    url: `${supabaseUrl}/storage/v1/object/public/${mediaBucket}/${encodeURI(path)}`,
    path,
  });
}

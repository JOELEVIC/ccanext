// Admin image-upload endpoint. The ccaadmin dashboard POSTs a multipart file
// here; we verify the admin bearer token, then stream the bytes to the public
// Supabase Storage bucket using the service-role key (which bypasses RLS). The
// browser never sees the service key, and large uploads never round-trip through
// GraphQL (which would hit Vercel's small JSON body limit).
import { config } from "@/config/env";
import { extractTokenFromHeader, verifyAdminToken } from "@/utils/jwt";

export const runtime = "nodejs";

// Mirror the GraphQL route's CORS policy: the dashboard lives on a hard-to-guess
// admin.<secret>.dchessacademy.com subdomain, plus any configured main origins.
const ENV_ORIGINS = config.cors.origin
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const ADMIN_ORIGIN_RE = /^https:\/\/admin\.[a-z0-9-]+\.dchessacademy\.com$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow =
    origin && (ENV_ORIGINS.includes(origin) || ADMIN_ORIGIN_RE.test(origin))
      ? origin
      : ENV_ORIGINS[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — matches the bucket limit
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

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

  // 1. Auth — same admin token the GraphQL admin resolvers require.
  const token = extractTokenFromHeader(req.headers.get("authorization") ?? undefined);
  if (!token) return json({ error: "Admin authentication required" }, 401);
  try {
    verifyAdminToken(token);
  } catch {
    return json({ error: "Invalid or expired admin token" }, 401);
  }

  // 2. Config check.
  const { serviceRoleKey, url: supabaseUrl, mediaBucket } = config.supabase;
  if (!serviceRoleKey) {
    return json(
      { error: "Image upload is not configured (missing SUPABASE_SERVICE_ROLE_KEY)" },
      500
    );
  }

  // 3. Read the file.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data with a 'file' field" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file provided" }, 400);

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED.includes(contentType)) {
    return json({ error: `Unsupported image type: ${contentType}` }, 415);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: "Image exceeds the 10MB limit" }, 413);
  }

  // 4. Build a collision-free path: yyyy/mm/<uuid>.<ext>
  const extFromType = contentType.split("/")[1] ?? "bin";
  const ext = (file.name.split(".").pop() || extFromType)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 5) || extFromType;
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const path = `${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;

  // 5. Upload to Supabase Storage (service key → bypasses RLS).
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${mediaBucket}/${encodeURI(path)}`;
  let up: Response;
  try {
    up = await fetch(uploadUrl, {
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

  const url = `${supabaseUrl}/storage/v1/object/public/${mediaBucket}/${encodeURI(path)}`;
  return json({ url, path });
}

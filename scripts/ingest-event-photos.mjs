/**
 * Ingest a folder of event photos into a published community Activity.
 *
 * For every image: an EXIF-rotated display rendition (max 1800px, JPEG) and a
 * grid thumbnail (max 640px, WebP) are generated with sharp and uploaded via
 * the DEPLOYED /api/admin/upload endpoint; the Activity row (+ gallery) is
 * then written via the DEPLOYED GraphQL admin mutations. Everything talks to
 * the live API — no direct database connection needed (the Supabase direct
 * host is not reachable from every network). Auth is an admin JWT minted
 * locally from the signing secret in .env.
 *
 * Re-running with the same --slug updates the post and replaces the gallery
 * (idempotent). Requires the target API to be deployed with gallery-field
 * support (ActivityImageInput.thumbUrl/width/height/highlight).
 *
 * Usage:
 *   node scripts/ingest-event-photos.mjs \
 *     --dir "/path/to/photos" \
 *     --title "Campus Chess Day at ASTI" \
 *     --date 2026-06-08 \
 *     --region "South-West" \
 *     --excerpt "Blitz boards, new members, and prizes at ASTI." \
 *     [--slug custom-slug] [--type EVENT_RECAP] [--highlights 10]
 *     [--featured] [--draft] [--body "Longer recap text…"] [--dry-run]
 *     [--api https://api.dchessacademy.com]
 *
 * Curation options, for when "every Nth frame" is not good enough:
 *   --tags a,b,c        tags to store (default: photos,on-campus). An update
 *                       replaces the whole array, so passing this is how you
 *                       avoid wiping tags an existing post already carries.
 *   --highlight 1388,…  source basenames to flag as highlights, instead of
 *                       spacing --highlights evenly across the set. The
 *                       highlights are the collage on the feed, so which ones
 *                       they are is an editorial decision, not an interval.
 *   --cover IMG_1388    source basename to use as the cover. Default is the
 *                       first landscape highlight.
 *   --body-file path    a text file of paragraphs, blank-line separated, in
 *                       place of --body. `## ` / `### ` start a heading, `- `
 *                       a bullet list, `> ` a blockquote, `**bold**` inline.
 *                       Recaps have structure; flat paragraphs lose it.
 */

import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const jwt = require("jsonwebtoken");

// ---------------------------------------------------------------------------
// env + args
// ---------------------------------------------------------------------------

function loadDotEnv(file = ".env") {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadDotEnv();

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const flag = ["featured", "draft", "dry-run"].includes(key);
    args[key] = flag ? true : argv[++i];
  }
  return args;
}
const args = parseArgs(process.argv);

const DIR = args.dir;
const TITLE = args.title;
if (!DIR || !TITLE) {
  console.error("Required: --dir <photo folder> --title <event title>");
  process.exit(1);
}
const TYPE = args.type ?? "EVENT_RECAP";
const HIGHLIGHT_COUNT = Number(args.highlights ?? 10);
const TAGS = (args.tags ?? "photos,on-campus").split(",").map((t) => t.trim()).filter(Boolean);
// Basenames, compared without extension so --highlight IMG_1388 matches
// IMG_1388.jpg / .jpeg / .heic alike.
const stem = (f) => f.replace(/\.[^.]+$/, "");
const HIGHLIGHT_NAMES = (args.highlight ?? "")
  .split(",")
  .map((h) => stem(h.trim()))
  .filter(Boolean);
const COVER_NAME = args.cover ? stem(args.cover) : null;
const SLUG =
  args.slug ??
  TITLE.toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const DISPLAY_EDGE = 1800;
const THUMB_EDGE = 640;
const CONCURRENCY = 4;

const API_BASE = (args.api ?? "https://api.dchessacademy.com").replace(/\/$/, "");
const UPLOAD_ENDPOINT = `${API_BASE}/api/admin/upload`;
const GRAPHQL_ENDPOINT = `${API_BASE}/api/graphql`;

// ---------------------------------------------------------------------------
// deployed-API client (upload + GraphQL admin mutations)
//
// Auth: preferably a real adminLogin against the deployed API (ADMIN_EMAIL +
// ADMIN_PASSWORD in .env, or --admin-email/--admin-password). Fallback is a
// locally-minted admin JWT, which only authenticates when the local signing
// secret matches the server's. Resolved lazily so --dry-run needs no auth.
// ---------------------------------------------------------------------------

let _tokenPromise = null;

function getAdminToken() {
  _tokenPromise ??= (async () => {
    const email = args["admin-email"] ?? process.env.ADMIN_EMAIL;
    const password = args["admin-password"] ?? process.env.ADMIN_PASSWORD;
    if (email && password) {
      const res = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `mutation($email: String!, $password: String!) {
            adminLogin(email: $email, password: $password) { token }
          }`,
          variables: { email, password },
        }),
      });
      const json = await res.json().catch(() => ({}));
      const token = json?.data?.adminLogin?.token;
      if (!token) {
        throw new Error(`adminLogin failed: ${JSON.stringify(json.errors ?? json)}`);
      }
      console.log(`Authenticated as ${email}`);
      return token;
    }
    const secret = process.env.ADMIN_JWT_SECRET ?? `${process.env.JWT_SECRET}::admin`;
    if (!process.env.ADMIN_JWT_SECRET && !process.env.JWT_SECRET) {
      throw new Error(
        "Need ADMIN_EMAIL+ADMIN_PASSWORD (preferred) or ADMIN_JWT_SECRET/JWT_SECRET in .env."
      );
    }
    console.log("No admin credentials — using a locally-minted token.");
    return jwt.sign({ adminId: "ingest-script", role: "ROOT", kind: "admin" }, secret, {
      expiresIn: "2h",
    });
  })();
  return _tokenPromise;
}

// Note: uploads land at unique yyyy/mm/<uuid> storage paths, so a re-run
// re-uploads fresh objects and the previous run's files become unreferenced
// (harmless, a few MB) — clean the bucket occasionally if that bothers you.
async function upload(buffer, contentType, filename) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  const res = await fetch(UPLOAD_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${await getAdminToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.url) throw new Error(`upload returned no url: ${JSON.stringify(json)}`);
  return json.url;
}

async function gql(query, variables) {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await getAdminToken()}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) {
    throw new Error(`graphql ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// image pipeline
// ---------------------------------------------------------------------------

const EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function processOne(file, index, total) {
  const src = path.join(DIR, file);
  const base = `${SLUG}-${String(index + 1).padStart(3, "0")}`;

  const display = await sharp(src)
    .rotate() // honor EXIF orientation before resizing
    .resize(DISPLAY_EDGE, DISPLAY_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, progressive: true, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const thumb = await sharp(src)
    .rotate()
    .resize(THUMB_EDGE, THUMB_EDGE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer({ resolveWithObject: true });

  if (args["dry-run"]) {
    console.log(
      `[dry] ${file} → display ${display.info.width}x${display.info.height} ` +
        `${(display.data.length / 1024).toFixed(0)}KB, thumb ${(thumb.data.length / 1024).toFixed(0)}KB`
    );
    return { file, url: `dry://${base}.jpg`, thumbUrl: `dry://${base}.webp`,
      width: display.info.width, height: display.info.height };
  }

  const url = await upload(display.data, "image/jpeg", `${base}.jpg`);
  const thumbUrl = await upload(thumb.data, "image/webp", `${base}-thumb.webp`);
  console.log(`[${index + 1}/${total}] ${file} → ${display.info.width}x${display.info.height}`);
  return { file, url, thumbUrl, width: display.info.width, height: display.info.height };
}

async function mapPool(items, worker, size) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

// Evenly spaced picks across the chronological set, so highlights sample the
// whole event (arrival, games, prizes) instead of one burst of frames.
function pickHighlights(count, total) {
  const n = Math.min(count, total);
  const picked = new Set();
  for (let k = 0; k < n; k++) {
    picked.add(Math.min(total - 1, Math.round((k * (total - 1)) / Math.max(1, n - 1))));
  }
  return picked;
}

// `**bold**` runs, split into Tiptap text nodes. Nothing else is inline —
// a recap needs emphasis, not a markdown implementation.
function inline(text) {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? { type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] }
        : { type: "text", text: part }
    );
}

const para = (t) => ({ type: "paragraph", content: inline(t) });

/** Blank-line-separated blocks → a Tiptap document. `##`/`###` heading,
 *  `- ` bullet list, `> ` blockquote, anything else a paragraph. */
function toTiptap(text) {
  const content = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const heading = lines[0].match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: inline(heading[2]),
      });
      lines.shift();
      if (!lines.length) continue;
    }

    if (lines.every((l) => l.startsWith("- "))) {
      content.push({
        type: "bulletList",
        content: lines.map((l) => ({
          type: "listItem",
          content: [para(l.slice(2))],
        })),
      });
      continue;
    }

    if (lines.every((l) => l.startsWith("> "))) {
      content.push({ type: "blockquote", content: [para(lines.map((l) => l.slice(2)).join(" "))] });
      continue;
    }

    content.push(para(lines.join(" ")));
  }
  return { type: "doc", content };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const files = readdirSync(DIR)
  .filter((f) => EXTENSIONS.has(path.extname(f).toLowerCase()))
  .sort(); // Photo_<ms>.jpg names sort chronologically

if (!files.length) {
  console.error(`No images found in ${DIR}`);
  process.exit(1);
}
console.log(
  `Ingesting ${files.length} photos from "${DIR}" as "${TITLE}" (slug: ${SLUG}) via ${API_BASE}`
);

const processed = await mapPool(files, (f, i) => processOne(f, i, files.length), CONCURRENCY);

// A named --highlight list is an editorial choice and always wins; even
// spacing is the fallback for an uncurated dump.
const named = HIGHLIGHT_NAMES.length
  ? new Set(processed.filter((img) => HIGHLIGHT_NAMES.includes(stem(img.file))).map((img) => img.file))
  : null;
if (named) {
  const missing = HIGHLIGHT_NAMES.filter((n) => !processed.some((img) => stem(img.file) === n));
  if (missing.length) console.warn(`  ! --highlight names not in --dir: ${missing.join(", ")}`);
}
const spaced = named ? null : pickHighlights(HIGHLIGHT_COUNT, processed.length);
const images = processed.map((img, i) => ({
  ...img,
  highlight: named ? named.has(img.file) : spaced.has(i),
}));

// Cover: the named one, else the first landscape highlight — wide frames read
// best in the hero and share-card slots, which are all landscape.
const cover =
  (COVER_NAME && images.find((img) => stem(img.file) === COVER_NAME)) ??
  images.find((img) => img.highlight && img.width >= img.height) ??
  images.find((img) => img.highlight) ??
  images[0];
if (COVER_NAME && stem(cover.file) !== COVER_NAME) {
  console.warn(`  ! --cover ${COVER_NAME} not in --dir; fell back to ${cover.file}`);
}

const bodySource = args["body-file"] ? readFileSync(args["body-file"], "utf8") : args.body;
const bodyText = bodySource ?? args.excerpt ?? null;
const bodyJson = bodyText ? JSON.stringify(toTiptap(bodyText)) : null;

if (args["dry-run"]) {
  console.log(`\n[dry] body:\n${bodyJson ? JSON.stringify(JSON.parse(bodyJson), null, 1) : "(none)"}`);
  console.log(`[dry] would write activity "${SLUG}": ${images.length} images, ` +
    `${images.filter((i) => i.highlight).length} highlights, cover ${cover.file}`);
  process.exit(0);
}


const input = {
  type: TYPE,
  title: TITLE,
  excerpt: args.excerpt ?? null,
  bodyText,
  bodyJson,
  coverImageUrl: cover.url,
  region: args.region ?? null,
  eventDate: args.date ? new Date(args.date).toISOString() : null,
  featured: Boolean(args.featured),
  tags: TAGS,
  images: images.map((img) => ({
    url: img.url,
    thumbUrl: img.thumbUrl,
    width: img.width,
    height: img.height,
    highlight: img.highlight,
  })),
};

// Idempotency: find an existing post with this slug via the admin list, then
// update it; otherwise create (the service would auto-suffix a duplicate slug).
const existing = await gql(
  `query($search: String) {
     adminActivities(search: $search, limit: 50) { items { id slug status } }
   }`,
  { search: TITLE }
);
const match = existing.adminActivities.items.find((a) => a.slug === SLUG);

const MUTATION_FIELDS = `id slug title status photoCount`;
let activity;
if (match) {
  const data = await gql(
    `mutation($id: ID!, $input: ActivityInput!) {
       adminUpdateActivity(id: $id, input: $input) { ${MUTATION_FIELDS} }
     }`,
    { id: match.id, input }
  );
  activity = data.adminUpdateActivity;
} else {
  const data = await gql(
    `mutation($input: ActivityInput!) {
       adminCreateActivity(input: $input) { ${MUTATION_FIELDS} }
     }`,
    { input }
  );
  activity = data.adminCreateActivity;
}

if (!args.draft && activity.status !== "PUBLISHED") {
  const data = await gql(
    `mutation($id: ID!) { adminPublishActivity(id: $id) { ${MUTATION_FIELDS} } }`,
    { id: activity.id }
  );
  activity = data.adminPublishActivity;
}

console.log(
  `\nDone: ${activity.photoCount} photos on "${activity.title}" ` +
    `(${activity.status.toLowerCase()}) → /community/${activity.slug}`
);

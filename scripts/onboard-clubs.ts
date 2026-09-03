/**
 * ══════════════════════════════════════════════════════════════════════════
 * Onboard real schools and clubs — PLATFORM_ROADMAP Milestone 3.2.
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   npx tsx scripts/onboard-clubs.ts data/clubs.json            # dry run
 *   npx tsx scripts/onboard-clubs.ts data/clubs.json --apply    # write
 *
 * Reads a list of real schools and creates, for each club: the School, the
 * Club, its division entry, and a join code. Idempotent — every row upserts on
 * a deterministic key, so a second run with a corrected spelling fixes the
 * spelling and changes nothing else.
 *
 * ── Why a script, and what it is now for ──────────────────────────────────
 *
 * It was written because there was no mutation anywhere that created a Club:
 * the school list arrived before the staff console did, and making the academy
 * wait for a UI to onboard the schools that UI exists to serve is the wrong
 * way round.
 *
 * The console now has `adminCreateClub`, so this is no longer the only door —
 * it is the BULK door, for a spreadsheet of forty schools, and it stays for
 * that. What it must not do is drift: the join-code alphabet is imported from
 * `domains/club/joinCode.ts` rather than kept here, so a code minted by a
 * script and one minted by the console are the same kind of thing.
 *
 * ── Dry run is the default, and it is not a formality ─────────────────────
 *
 * Onboarding writes the rows the entire public site is about. A typo in a
 * region key silently files a club in the wrong catchment, and a division
 * table is derived from catchment. So the default prints exactly what would
 * change — creates, updates, and no-ops, one line each — and touches nothing
 * until `--apply`.
 *
 * ── What it refuses to do ─────────────────────────────────────────────────
 *
 *   · A region that is not one of the ten canonical keys. Free text in
 *     `Club.region` is how a club vanishes from its own region's map — there
 *     is already one legacy row in this database with "South-West" instead of
 *     "SOUTH_WEST", and it belongs to nothing as a result.
 *   · A division that does not exist in the target season.
 *   · A duplicate slug or join code inside the input file, before writing
 *     anything. Finding that out from a unique-constraint violation halfway
 *     through leaves a half-onboarded academy.
 *
 * ── The input ─────────────────────────────────────────────────────────────
 *
 * [
 *   {
 *     "school": "Government Bilingual High School Limbe",
 *     "town": "Limbe",
 *     "region": "SOUTH_WEST",
 *     "kind": "SECONDARY",
 *     "clubs": [
 *       { "name": "GBHS Limbe Chess Club", "shortName": "GL", "division": "Fako & Meme" }
 *     ]
 *   }
 * ]
 *
 * `slug` is derived from the club name unless given. `level` follows the
 * school's `kind` unless given. Everything else is required, on purpose.
 */

import { randomInt } from "node:crypto";
import { makeJoinCode } from "../domains/club/joinCode";
import { readFileSync } from "node:fs";

import { ClubLevel, ClubStatus, PrismaClient, SchoolKind } from "@prisma/client";

import { REGION_KEYS } from "../domains/region/regions";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const FILE = process.argv[2];

type ClubInput = {
  name: string;
  shortName: string;
  division: string;
  slug?: string;
  level?: keyof typeof ClubLevel;
  joinCode?: string;
};

type SchoolInput = {
  school: string;
  town: string;
  region: string;
  kind?: keyof typeof SchoolKind;
  clubs: ClubInput[];
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * A join code a patron reads aloud in a noisy hall and a student types once.
 *
 * No 0/O, no 1/I/L: those are the pairs people get wrong, and a wrong code is
 * indistinguishable from a rejected one. Six characters from a 30-symbol
 * alphabet is ~730 million combinations, which is far more than the guessing
 * matters — the code only ever creates a PENDING membership a patron must then
 * admit, so it is a convenience, not a credential.
 */
// The alphabet and the shape now live in `domains/club/joinCode.ts`, shared
// with the console's own club creation. Two generators would eventually
// disagree about which characters are safe, and being the same everywhere is
// the entire point of the alphabet.

async function uniqueJoinCode(taken: Set<string>): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = makeJoinCode(randomInt);
    if (taken.has(code)) continue;
    if (await prisma.club.findUnique({ where: { joinCode: code }, select: { id: true } })) continue;
    taken.add(code);
    return code;
  }
  throw new Error("Could not find an unused join code in 50 attempts");
}

type Plan = { action: "create" | "update" | "unchanged"; what: string; detail?: string };

async function main() {
  if (!FILE) {
    console.error("Usage: npx tsx scripts/onboard-clubs.ts <file.json> [--apply]");
    process.exit(1);
  }

  const input = JSON.parse(readFileSync(FILE, "utf8")) as SchoolInput[];
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("The input must be a non-empty array of schools");
  }

  // ── Validate everything before writing anything ─────────────────────────
  const season = await prisma.season.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, divisions: { select: { id: true, name: true } } },
  });
  if (!season) throw new Error("No ACTIVE season. Create the season before onboarding clubs.");

  const divisionByName = new Map(season.divisions.map((d) => [d.name.toLowerCase(), d.id]));
  const problems: string[] = [];
  const seenSlugs = new Set<string>();
  const seenCodes = new Set<string>();

  for (const school of input) {
    if (!REGION_KEYS.includes(school.region as (typeof REGION_KEYS)[number])) {
      problems.push(
        `${school.school}: region ${JSON.stringify(school.region)} is not one of ${REGION_KEYS.join(", ")}`
      );
    }
    if (!school.town?.trim()) problems.push(`${school.school}: town is required`);
    if (!school.clubs?.length) problems.push(`${school.school}: needs at least one club`);

    for (const club of school.clubs ?? []) {
      if (!divisionByName.has(club.division?.toLowerCase() ?? "")) {
        problems.push(
          `${club.name}: division ${JSON.stringify(club.division)} is not in season ${season.name} (have: ${season.divisions.map((d) => d.name).join(", ")})`
        );
      }
      if (!/^[A-Z0-9]{2,3}$/.test(club.shortName ?? "")) {
        problems.push(`${club.name}: shortName must be 2-3 uppercase characters (drives the crest)`);
      }
      const slug = club.slug ?? slugify(club.name);
      if (seenSlugs.has(slug)) problems.push(`${club.name}: duplicate slug ${slug} inside this file`);
      seenSlugs.add(slug);
      if (club.joinCode) {
        if (seenCodes.has(club.joinCode)) problems.push(`${club.name}: duplicate join code in this file`);
        seenCodes.add(club.joinCode);
      }
    }
  }

  if (problems.length) {
    console.error(`\nRefusing to onboard — ${problems.length} problem(s):\n`);
    problems.forEach((p) => console.error("  · " + p));
    process.exit(1);
  }

  // ── Plan ────────────────────────────────────────────────────────────────
  const plan: Plan[] = [];

  for (const school of input) {
    const schoolSlug = slugify(school.school);
    const existingSchool = await prisma.school.findFirst({
      where: { slug: schoolSlug },
      select: { id: true, name: true, town: true, region: true },
    });

    plan.push({
      action: existingSchool
        ? existingSchool.name === school.school && existingSchool.town === school.town
          ? "unchanged"
          : "update"
        : "create",
      what: `school ${school.school}`,
      detail: `${school.town} · ${school.region}`,
    });

    const schoolId = existingSchool?.id;

    if (APPLY) {
      const row = await prisma.school.upsert({
        where: { slug: schoolSlug },
        create: {
          slug: schoolSlug,
          name: school.school,
          town: school.town,
          region: school.region,
          kind: (school.kind ?? "SECONDARY") as SchoolKind,
        },
        update: { name: school.school, town: school.town, region: school.region },
      });
      await onboardClubs(school, row.id, divisionByName, seenCodes, plan);
    } else {
      await onboardClubs(school, schoolId ?? null, divisionByName, seenCodes, plan);
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────
  const counts = { create: 0, update: 0, unchanged: 0 };
  console.log(`\nSeason ${season.name}${APPLY ? "" : "  (DRY RUN — nothing written)"}\n`);
  for (const row of plan) {
    counts[row.action] += 1;
    const mark = row.action === "create" ? "+" : row.action === "update" ? "~" : " ";
    console.log(`  ${mark} ${row.what}${row.detail ? `  ${row.detail}` : ""}`);
  }
  console.log(
    `\n${counts.create} to create, ${counts.update} to update, ${counts.unchanged} unchanged.`
  );
  if (!APPLY) console.log("Re-run with --apply to write.");
}

async function onboardClubs(
  school: SchoolInput,
  schoolId: string | null,
  divisionByName: Map<string, string>,
  seenCodes: Set<string>,
  plan: Plan[]
) {
  for (const club of school.clubs) {
    const slug = club.slug ?? slugify(club.name);
    const existing = await prisma.club.findUnique({
      where: { slug },
      select: { id: true, name: true, joinCode: true },
    });

    plan.push({
      action: existing ? (existing.name === club.name ? "unchanged" : "update") : "create",
      what: `  club ${club.name}`,
      detail: existing
        ? `${club.division} · code ${existing.joinCode}`
        : `${club.division} · new join code`,
    });

    if (!APPLY || !schoolId) continue;

    const divisionId = divisionByName.get(club.division.toLowerCase())!;
    // An existing club keeps its code: patrons have handed it out, and
    // rotating it on a re-run would silently lock out everyone holding it.
    const joinCode = existing?.joinCode ?? club.joinCode ?? (await uniqueJoinCode(seenCodes));

    const row = await prisma.club.upsert({
      where: { slug },
      create: {
        slug,
        name: club.name,
        shortName: club.shortName,
        schoolId,
        region: school.region,
        level: (club.level ?? (school.kind === "UNIVERSITY" ? "UNIVERSITY" : "SECONDARY")) as ClubLevel,
        // Null on purpose: BUILD_PLAN §5 says a complete crest derives from the
        // slug, and writing one here would hide a broken fallback.
        crestJson: undefined,
        joinCode,
        status: ClubStatus.ONBOARDING,
      },
      update: { name: club.name, shortName: club.shortName, region: school.region },
    });

    // The division entry is what puts a club in a table. Without it the club
    // page renders but the club is in no competition.
    const entry = await prisma.divisionEntry.findFirst({
      where: { divisionId, clubId: row.id },
      select: { id: true },
    });
    if (!entry) {
      await prisma.divisionEntry.create({ data: { divisionId, clubId: row.id } });
    }
  }
}

main()
  .catch((error) => {
    console.error("\n" + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

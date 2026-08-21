/**
 * Cameroon's ten administrative regions, as a CANONICAL KEY SET — plus the four
 * competition zones built on top of them.
 *
 * Pure module: no Prisma import, no I/O. The house pattern is
 * `domains/tournament/pairing.ts` and `domains/fixture/scoring.ts`.
 *
 * Why this exists (BUILD_PLAN §2):
 *
 *   "Regions are a fixed key set, not free text. `Club.region` and `Division`'s
 *    catchment use the canonical keys FAR_NORTH NORTH ADAMAWA CENTRE EAST SOUTH
 *    LITTORAL WEST NORTH_WEST SOUTH_WEST. […] Note the existing `Activity.region`
 *    column holds French free text ("Sud-Ouest") — T0.1 includes a normalisation
 *    pass."
 *
 * Display names (EN + FR) are deliberately NOT here: they live in `ccaweb`'s
 * `content/regions.ts` (P0-B). This module owns the KEYS, the aliases that map
 * legacy free text onto them, and the zone grouping.
 *
 * A REGION IS NOT A ZONE. A region is a place; a zone is a competitive grouping
 * of divisions feeding the zonal finals. Divisions are named after their
 * catchment (`Fako & Meme`), never after a region.
 */

// ── Regions ───────────────────────────────────────────────────────────────────

export const REGION_KEYS = [
  "FAR_NORTH",
  "NORTH",
  "ADAMAWA",
  "CENTRE",
  "EAST",
  "SOUTH",
  "LITTORAL",
  "WEST",
  "NORTH_WEST",
  "SOUTH_WEST",
] as const;

export type RegionKey = (typeof REGION_KEYS)[number];

const REGION_SET: ReadonlySet<string> = new Set(REGION_KEYS);

export function isRegionKey(value: unknown): value is RegionKey {
  return typeof value === "string" && REGION_SET.has(value);
}

// ── Zones ─────────────────────────────────────────────────────────────────────

/**
 * The four zones. LOCKED by the academy (BUILD_PLAN §13 "Zone composition"):
 * a geographic four-way split covering all ten regions, so every region belongs
 * to exactly one zone and the zonal finals have a complete map.
 */
export const ZONE_KEYS = ["COASTAL", "GRASSFIELDS", "CENTRE_SOUTH", "NORTHERN"] as const;

export type ZoneKey = (typeof ZONE_KEYS)[number];

export const ZONE_REGIONS: Readonly<Record<ZoneKey, readonly RegionKey[]>> = {
  COASTAL: ["LITTORAL", "SOUTH_WEST"],
  GRASSFIELDS: ["WEST", "NORTH_WEST"],
  CENTRE_SOUTH: ["CENTRE", "SOUTH", "EAST"],
  NORTHERN: ["ADAMAWA", "NORTH", "FAR_NORTH"],
};

const REGION_TO_ZONE: Readonly<Record<RegionKey, ZoneKey>> = (() => {
  const out = {} as Record<RegionKey, ZoneKey>;
  for (const zone of ZONE_KEYS) {
    for (const region of ZONE_REGIONS[zone]) out[region] = zone;
  }
  return out;
})();

/** The zone a region belongs to. Every canonical region has exactly one. */
export function zoneForRegion(region: string): ZoneKey | null {
  const key = normalizeRegion(region);
  return key ? REGION_TO_ZONE[key] : null;
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Aliases seen in the legacy data and in French copy. Keys are already reduced
 * by `slugify` below, so "Sud-Ouest", "sud ouest" and "SUD‑OUEST" all land on
 * "sud-ouest". Matching is EXACT on the reduced form, never by prefix — "nord"
 * must not swallow "nord-ouest".
 */
const REGION_ALIASES: Readonly<Record<string, RegionKey>> = {
  // Far North
  "extreme-nord": "FAR_NORTH",
  "far-north": "FAR_NORTH",
  "far-nord": "FAR_NORTH",
  "extremenord": "FAR_NORTH",
  "far_north": "FAR_NORTH",
  // North
  nord: "NORTH",
  north: "NORTH",
  // Adamawa
  adamaoua: "ADAMAWA",
  adamawa: "ADAMAWA",
  // Centre
  centre: "CENTRE",
  center: "CENTRE",
  central: "CENTRE",
  // East
  est: "EAST",
  east: "EAST",
  // South
  sud: "SOUTH",
  south: "SOUTH",
  // Littoral
  littoral: "LITTORAL",
  // West
  ouest: "WEST",
  west: "WEST",
  // North-West
  "nord-ouest": "NORTH_WEST",
  "north-west": "NORTH_WEST",
  "nordouest": "NORTH_WEST",
  "north_west": "NORTH_WEST",
  nw: "NORTH_WEST",
  // South-West
  "sud-ouest": "SOUTH_WEST",
  "south-west": "SOUTH_WEST",
  "sudouest": "SOUTH_WEST",
  "south_west": "SOUTH_WEST",
  sw: "SOUTH_WEST",
};

/** Lowercase, strip accents, collapse anything non-alphanumeric to a single "-". */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Map anything — a canonical key, French free text, an English display name —
 * onto a canonical region key. Returns null when it cannot be resolved, so the
 * caller decides whether that is a filter miss or a validation error. NEVER
 * guesses: an unrecognised value stays unrecognised.
 */
export function normalizeRegion(value: string | null | undefined): RegionKey | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (REGION_SET.has(upper)) return upper as RegionKey;
  return REGION_ALIASES[slugify(raw)] ?? null;
}

// ── Roll-out roadmap ──────────────────────────────────────────────────────────

/**
 * `NetworkSummary.clubsByRegion[].opensIn` — the year the academy expects to
 * open a region that has no clubs yet. It is EDITORIAL, not derived: there is
 * no column for it and no way to compute it. Returned only for regions with
 * zero clubs; once a region has a club it is live and this is null.
 *
 * Update this map when the academy commits to a date. It is the single place a
 * "opens 2027" badge on the public region map comes from.
 */
export const REGION_OPENS_IN: Readonly<Record<RegionKey, number>> = {
  SOUTH_WEST: 2027,
  LITTORAL: 2027,
  NORTH_WEST: 2027,
  CENTRE: 2027,
  WEST: 2027,
  SOUTH: 2027,
  EAST: 2028,
  ADAMAWA: 2028,
  NORTH: 2028,
  FAR_NORTH: 2028,
};

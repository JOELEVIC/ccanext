import { describe, it, expect } from "vitest";
import {
  REGION_KEYS,
  REGION_OPENS_IN,
  ZONE_KEYS,
  ZONE_REGIONS,
  isRegionKey,
  normalizeRegion,
  zoneForRegion,
} from "./regions";

describe("the canonical region key set", () => {
  it("is Cameroon's ten regions and nothing else", () => {
    expect(REGION_KEYS).toHaveLength(10);
    expect([...REGION_KEYS].sort()).toEqual(
      ["ADAMAWA", "CENTRE", "EAST", "FAR_NORTH", "LITTORAL", "NORTH", "NORTH_WEST", "SOUTH", "SOUTH_WEST", "WEST"].sort()
    );
  });

  it("has a roll-out year for every region, so the map never renders a blank badge", () => {
    for (const key of REGION_KEYS) expect(typeof REGION_OPENS_IN[key]).toBe("number");
  });

  it("recognises its own keys", () => {
    expect(isRegionKey("SOUTH_WEST")).toBe(true);
    expect(isRegionKey("Sud-Ouest")).toBe(false);
  });
});

describe("normalizeRegion", () => {
  it("maps the legacy French free text in activities.region onto canonical keys", () => {
    expect(normalizeRegion("Sud-Ouest")).toBe("SOUTH_WEST");
    expect(normalizeRegion("Nord-Ouest")).toBe("NORTH_WEST");
    expect(normalizeRegion("Extreme-Nord")).toBe("FAR_NORTH");
    expect(normalizeRegion("Extrême-Nord")).toBe("FAR_NORTH");
    expect(normalizeRegion("Adamaoua")).toBe("ADAMAWA");
    expect(normalizeRegion("Ouest")).toBe("WEST");
    expect(normalizeRegion("Est")).toBe("EAST");
    expect(normalizeRegion("Sud")).toBe("SOUTH");
  });

  it("is idempotent on canonical keys", () => {
    for (const key of REGION_KEYS) expect(normalizeRegion(key)).toBe(key);
  });

  it("never lets a shorter name swallow a longer one", () => {
    expect(normalizeRegion("Nord")).toBe("NORTH");
    expect(normalizeRegion("Nord Ouest")).toBe("NORTH_WEST");
    expect(normalizeRegion("Sud")).toBe("SOUTH");
    expect(normalizeRegion("sud ouest")).toBe("SOUTH_WEST");
  });

  it("returns null rather than guessing", () => {
    expect(normalizeRegion("Banana")).toBeNull();
    expect(normalizeRegion("")).toBeNull();
    expect(normalizeRegion(null)).toBeNull();
    expect(normalizeRegion(undefined)).toBeNull();
  });
});

describe("the four zones", () => {
  it("cover all ten regions exactly once", () => {
    const seen = ZONE_KEYS.flatMap((z) => [...ZONE_REGIONS[z]]);
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });

  it("match the locked geographic split", () => {
    expect(ZONE_REGIONS.COASTAL).toEqual(["LITTORAL", "SOUTH_WEST"]);
    expect(ZONE_REGIONS.GRASSFIELDS).toEqual(["WEST", "NORTH_WEST"]);
    expect(ZONE_REGIONS.CENTRE_SOUTH).toEqual(["CENTRE", "SOUTH", "EAST"]);
    expect(ZONE_REGIONS.NORTHERN).toEqual(["ADAMAWA", "NORTH", "FAR_NORTH"]);
  });

  it("resolve from free text too, since a zone is not a region", () => {
    expect(zoneForRegion("Sud-Ouest")).toBe("COASTAL");
    expect(zoneForRegion("CENTRE")).toBe("CENTRE_SOUTH");
    expect(zoneForRegion("nowhere")).toBeNull();
  });
});

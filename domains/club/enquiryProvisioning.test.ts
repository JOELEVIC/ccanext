import { describe, expect, it } from "vitest";

import { deriveShortName } from "./enquiryProvisioning";

/**
 * The crest mark, from a name somebody typed into a form on a phone.
 *
 * It has to produce something for every input, because the alternative is a
 * club with a blank shield — and the name arrives unsupervised: "gbhs limbe",
 * "Lycée d'Akwa", one word, four words, punctuation.
 */
describe("deriving the crest mark", () => {
  it("skips the words every chess club shares", () => {
    // Otherwise every mark in the directory ends CC and the crest stops
    // identifying anything.
    expect(deriveShortName("GBHS Limbe Chess Club")).toBe("GL");
    expect(deriveShortName("Club d'échecs de Bafoussam")).toBe("BAF");
  });

  it("reads accents as their base letters", () => {
    expect(deriveShortName("Lycée Général Leclerc")).toBe("LGL");
  });

  it("caps at four, because the mark is drawn small", () => {
    expect(deriveShortName("Government Bilingual High School Molyko Buea")).toBe("GBHS");
  });

  it("falls back to letters when the name is one word", () => {
    expect(deriveShortName("Bafoussam")).toBe("BAF");
  });

  it("still returns two characters for a name with almost nothing in it", () => {
    // "Chess Club" is entirely skip-words: the initials path yields nothing and
    // the fallback has to carry it.
    expect(deriveShortName("Chess Club").length).toBeGreaterThanOrEqual(2);
    expect(deriveShortName("Ax").length).toBeGreaterThanOrEqual(2);
  });
});

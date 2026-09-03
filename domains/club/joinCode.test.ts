import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  nextFreeSlug,
  CODE_LENGTH,
  EXCLUDED_CHARACTERS,
  joinCodeProblem,
  makeJoinCode,
  slugify,
} from "./joinCode";

describe("the alphabet", () => {
  it("contains none of the characters people misread", () => {
    // The reason the alphabet exists. A code with an O in it will be read
    // aloud as a zero by somebody at the back of a classroom.
    for (const character of EXCLUDED_CHARACTERS) {
      expect(CODE_ALPHABET).not.toContain(character);
    }
    // Thirty-one symbols: twenty-three letters and eight digits. Pinned
    // because the ~900 million combinations the header claims are a function
    // of this number, and quietly dropping a character halves the space.
    expect(CODE_ALPHABET).toHaveLength(31);
    expect(new Set(CODE_ALPHABET).size).toBe(31);
  });
});

describe("minting", () => {
  it("is six characters, all from the alphabet", () => {
    // Driven rather than sampled: a generator that emitted a zero would be
    // caught by real randomness only by luck.
    let n = 0;
    const code = makeJoinCode(() => n++ % CODE_ALPHABET.length);
    expect(code).toHaveLength(CODE_LENGTH);
    expect(joinCodeProblem(code)).toBeNull();
  });

  it("walks the whole alphabet without producing a bad character", () => {
    for (let start = 0; start < CODE_ALPHABET.length; start += 1) {
      let n = start;
      const code = makeJoinCode(() => n++ % CODE_ALPHABET.length);
      expect(joinCodeProblem(code)).toBeNull();
    }
  });
});

describe("checking a code somebody typed", () => {
  it("accepts one this system could have minted", () => {
    expect(joinCodeProblem("ABC234")).toBeNull();
  });

  it("refuses the wrong length", () => {
    expect(joinCodeProblem("ABC23")).toBe("length");
    expect(joinCodeProblem("ABC2345")).toBe("length");
  });

  it("refuses the confusable characters by name", () => {
    expect(joinCodeProblem("ABC23O")).toBe("alphabet");
    expect(joinCodeProblem("ABC231")).toBe("alphabet");
    expect(joinCodeProblem("abc234")).toBe("alphabet");
  });
});

describe("slugs", () => {
  it("makes a URL out of a club's name", () => {
    expect(slugify("GBHS Limbe")).toBe("gbhs-limbe");
    expect(slugify("  Sacred Heart College,  Mankon ")).toBe(
      "sacred-heart-college-mankon",
    );
  });

  it("strips the accents rather than the letters", () => {
    // "lyce" would be a different school.
    expect(slugify("Lycée Général Leclerc")).toBe("lycee-general-leclerc");
  });

  it("never begins or ends with a dash", () => {
    expect(slugify("!! Club !!")).toBe("club");
  });
});

describe("slug collisions", () => {
  it("takes the plain slug when it is free", () => {
    expect(nextFreeSlug("gbhs-limbe", new Set())).toBe("gbhs-limbe");
  });

  it("numbers from two, leaving the first club's URL alone", () => {
    // Two schools called GBHS Limbe is a normal case here, not a surprise.
    // The club that got there first keeps `gbhs-limbe`; renumbering it would
    // break a public page somebody has already linked to.
    expect(nextFreeSlug("gbhs-limbe", new Set(["gbhs-limbe"]))).toBe("gbhs-limbe-2");
    expect(
      nextFreeSlug("gbhs-limbe", new Set(["gbhs-limbe", "gbhs-limbe-2"])),
    ).toBe("gbhs-limbe-3");
  });

  it("falls back to a word rather than an empty slug", () => {
    // A club named only in a script this slugifier strips would otherwise
    // become "", and "" is a URL that means the clubs index.
    expect(nextFreeSlug(slugify("!!!"), new Set())).toBe("club");
  });
});

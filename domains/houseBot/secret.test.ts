import { describe, expect, it } from "vitest";
import { isHouseBotSecretValid } from "./secret";

describe("the house-bot secret", () => {
  const real = "a-secret-that-is-at-least-thirty-two-characters";

  it("is refused when nothing is configured", () => {
    expect(isHouseBotSecretValid(undefined, real)).toBe(false);
    expect(isHouseBotSecretValid("", real)).toBe(false);
  });

  it("is refused when wrong, whatever the length", () => {
    expect(isHouseBotSecretValid(real, "nope")).toBe(false);
    expect(isHouseBotSecretValid(real, real + "x")).toBe(false);
    expect(isHouseBotSecretValid(real, "")).toBe(false);
  });

  it("is accepted when exact", () => {
    expect(isHouseBotSecretValid(real, real)).toBe(true);
  });
});

import { createHash, timingSafeEqual } from "crypto";

/**
 * Is `given` the configured house-bot secret?
 *
 * False whenever nothing is configured: an unset secret means the house
 * players do not exist, not that anybody may act as them. Compared as two
 * SHA-256 digests so the comparison is constant-time and cannot leak the
 * length of the real secret through an early exit.
 */
export function isHouseBotSecretValid(configured: string | undefined, given: string): boolean {
  if (!configured || !given) return false;
  const a = createHash("sha256").update(configured).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

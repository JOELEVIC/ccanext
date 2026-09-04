import type { PrismaClient } from "@prisma/client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Switches staff can throw without a deploy.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One key/value row per lever. A column per setting would be tidier to read
 * and wrong in the way that matters: these are operational policies somebody
 * changes on a Tuesday afternoon, not attributes of anything, and a column
 * means a migration and a deploy every time the answer changes.
 *
 * ── An unwritten key is the safe answer, not an error ────────────────────
 *
 * Every read goes through [get], which falls back to the default declared in
 * [DEFAULTS]. So an empty table behaves exactly like every switch in its safe
 * position, a key nobody has ever written behaves like a key nobody has ever
 * changed, and a row somebody deletes by hand restores the default rather
 * than breaking the resolver that reads it.
 *
 * That is why nothing is seeded. A seeded row would make "never configured"
 * and "configured to the default" indistinguishable, and the first is the
 * state this table should mostly be in.
 */

/**
 * Every key this service knows, with the value it takes when nothing has been
 * written. Adding a key here is what makes it readable; there is deliberately
 * no way to read an arbitrary string, so a typo in a resolver is a type error
 * rather than a silent `undefined`.
 */
export const DEFAULTS = {
  /**
   * Whether a club created by somebody who is not staff has to be approved
   * before it exists.
   *
   * FALSE. A club created here goes live immediately, in ONBOARDING, with its
   * creator installed as patron — in the directory, reachable by slug, join
   * code working.
   *
   * This was TRUE, and the reasoning was sound: a club is an institution whose
   * members are children and whose name sits in a public directory beside real
   * schools, so a human should look first. What changed is not the risk but who
   * carries the cost of it. With nobody watching a review queue, "a human looks
   * first" is not moderation — it is a teacher waiting on a person who is not
   * coming, which is the failure mode `selfServe.service.ts` was written to end
   * and which the queue quietly reintroduced.
   *
   * The safeguards that remain are real ones rather than a promise to look:
   * creating a club needs an ACCOUNT, one active membership per person blocks a
   * second club, a duplicate name is refused, and a self-serve club is always
   * INDEPENDENT — it cannot claim a school, because that claim is what the
   * enquiry funnel exists to verify.
   *
   * What is genuinely given up: a junk club can reach the public directory
   * before anybody sees it. The answer to that is `PENDING_REVIEW` still
   * existing and this switch still being a switch — turn it back on the day
   * somebody is actually reading the queue.
   */
  "club.creation.requiresApproval": false,
} as const;

export type PlatformSettingKey = keyof typeof DEFAULTS;

export class PlatformSettingService {
  constructor(private prisma: PrismaClient) {}

  /**
   * One setting, or its default.
   *
   * Never throws for a missing row and never throws for a row holding the
   * wrong shape: a value whose type does not match the default is treated as
   * absent. Somebody hand-editing this table in the Supabase console must not
   * be able to make club creation crash by typing a string where a boolean
   * belongs.
   */
  async get<K extends PlatformSettingKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
    const fallback = DEFAULTS[key];
    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    return typeof row.value === typeof fallback
      ? (row.value as (typeof DEFAULTS)[K])
      : fallback;
  }

  /** Every key, with whatever is stored or the default. For the dashboard. */
  async all(): Promise<{ key: PlatformSettingKey; value: unknown }[]> {
    const rows = await this.prisma.platformSetting.findMany();
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    return (Object.keys(DEFAULTS) as PlatformSettingKey[]).map((key) => {
      const value = stored.get(key);
      return {
        key,
        value: typeof value === typeof DEFAULTS[key] ? value : DEFAULTS[key],
      };
    });
  }

  /**
   * Write one. Admin-gated at the resolver, like every other admin operation
   * in this codebase — the service stays domain-plain and testable without a
   * token.
   *
   * An unknown key is refused rather than stored. The table would happily
   * take it, and it would sit there for ever being read by nothing.
   */
  async set(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    if (!(key in DEFAULTS)) {
      throw new Error(`Unknown platform setting "${key}".`);
    }
    const expected = typeof DEFAULTS[key as PlatformSettingKey];
    if (typeof value !== expected) {
      throw new Error(`Setting "${key}" takes a ${expected}.`);
    }
    const row = await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never },
    });
    return { key: row.key, value: row.value };
  }
}

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
   * TRUE, and the default matters more than the value. A club is an
   * institution whose members are children and whose name appears in a public
   * directory beside real schools; the safe position is that a human looks
   * first. Staff can turn it off, and turning it off is a decision somebody
   * takes rather than a state the platform drifts into.
   */
  "club.creation.requiresApproval": true,
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

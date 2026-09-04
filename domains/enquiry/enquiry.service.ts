import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { ClubKind, ClubLevel, EnquiryStatus } from "@prisma/client";
import { EnquiryRepository } from "./enquiry.repository";
import { normalizeRegion } from "@/domains/region/regions";

/**
 * `submitSchoolEnquiry` is the only PUBLIC, UNAUTHENTICATED write in the Phase 1
 * surface, which makes it the only thing on the API a script can hammer for
 * free. It is defended three ways (BUILD_PLAN §6):
 *
 *   1. A HONEYPOT field the real form leaves empty. A filled honeypot is
 *      answered with an ordinary-looking success and nothing is written — a bot
 *      that is told it failed simply tries again with the field cleared.
 *   2. An IP throttle, backed by a TABLE. Vercel serverless has no shared
 *      memory: an in-process counter would reset with every cold container and
 *      protect nothing.
 *   3. A PHONE throttle, so rotating IPs does not buy an unlimited number of
 *      enquiries for the same number.
 *
 * The throttle stores SHA-256 digests, never the raw IP. The table's job is to
 * say "too many", not to accumulate a log of who visited.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;
const IP_LIMIT = 5;
const PHONE_LIMIT = 3;

const LIMITS = {
  schoolName: 160,
  town: 80,
  sizeBand: 40,
  contactName: 120,
  contactRole: 80,
  contactPhone: 32,
  contactEmail: 160,
  note: 2000,
} as const;

export type EnquiryResultCode = "OK" | "VALIDATION" | "RATE_LIMITED" | "ERROR";

export interface SchoolEnquiryResult {
  ok: boolean;
  id: string | null;
  code: EnquiryResultCode;
  message: string;
}

export interface SchoolEnquiryInput {
  schoolName: string;
  town?: string | null;
  region: string;
  kind?: ClubKind | null;
  level?: ClubLevel | null;
  sizeBand?: string | null;
  contactName: string;
  contactRole?: string | null;
  contactPhone: string;
  contactEmail?: string | null;
  note?: string | null;
  wantsFrench?: boolean | null;
  /** Honeypot. A real client never fills this in. */
  website?: string | null;
}

const THANKS =
  "Thank you — your enquiry has reached the academy. Someone will be in touch within three working days.";

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function tooLong(value: string, max: number): boolean {
  return value.length > max;
}

/** Digits only, last nine — Cameroon subscriber numbers, country code stripped. */
export function normalizePhone(raw: string): string {
  const digits = clean(raw).replace(/\D+/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

function digest(value: string): string {
  return createHash("sha256")
    .update(`${process.env.ENQUIRY_THROTTLE_SALT ?? "cca"}:${value}`)
    .digest("hex");
}

export class EnquiryService {
  private repo: EnquiryRepository;

  constructor(private prisma: PrismaClient) {
    this.repo = new EnquiryRepository(prisma);
  }

  async submit(
    input: SchoolEnquiryInput,
    meta: { ip?: string | null } = {}
  ): Promise<SchoolEnquiryResult> {
    const now = new Date();
    const ipKey = digest(clean(meta.ip) || "unknown");

    // 1 — Honeypot. Burn the IP's budget, then answer as if all was well.
    if (clean(input.website).length > 0) {
      await this.repo.consume("IP", ipKey, IP_LIMIT, WINDOW_MS, now);
      return { ok: true, id: null, code: "OK", message: THANKS };
    }

    // 2 — Validation.
    const schoolName = clean(input.schoolName);
    const contactName = clean(input.contactName);
    const contactPhone = clean(input.contactPhone);
    const region = normalizeRegion(input.region);

    // "school name" would be wrong for an independent club, whose own name
    // goes in this field. The column keeps its shipped name; the message does not.
    if (!schoolName) return invalid("A name is required.");
    if (!contactName) return invalid("A contact name is required.");
    if (!contactPhone) return invalid("A contact phone number is required.");
    if (!region) {
      return invalid("Choose one of Cameroon's ten regions.");
    }
    if (normalizePhone(contactPhone).length < 9) {
      return invalid("That phone number does not look complete.");
    }
    const email = clean(input.contactEmail);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return invalid("That email address does not look right.");
    }
    for (const [field, max] of Object.entries(LIMITS)) {
      const value = clean((input as unknown as Record<string, string | undefined>)[field]);
      if (tooLong(value, max)) return invalid(`${field} is too long (max ${max} characters).`);
    }

    // 3 — Throttle: IP first, then the phone number, so rotating one does not
    //     defeat the other.
    const byIp = await this.repo.consume("IP", ipKey, IP_LIMIT, WINDOW_MS, now);
    if (!byIp.allowed) return rateLimited();

    const byPhone = await this.repo.consume(
      "PHONE",
      digest(normalizePhone(contactPhone)),
      PHONE_LIMIT,
      WINDOW_MS,
      now
    );
    if (!byPhone.allowed) return rateLimited();

    let created;
    try {
      created = await this.repo.create({
        schoolName,
        town: clean(input.town) || null,
        region,
        // An independent enquiry has no school and therefore no education
        // stage. The old unconditional default filed every one of them as a
        // secondary school, mislabelled all the way to the staff queue.
        kind: input.kind ?? ClubKind.SCHOOL,
        level:
          (input.kind ?? ClubKind.SCHOOL) === ClubKind.INDEPENDENT
            ? null
            : (input.level ?? ClubLevel.SECONDARY),
        sizeBand: clean(input.sizeBand) || null,
        contactName,
        contactRole: clean(input.contactRole) || null,
        contactPhone,
        contactEmail: email || null,
        note: clean(input.note) || null,
        wantsFrench: input.wantsFrench ?? false,
      });
    } catch (cause) {
      /**
       * A write that fails must not become a masked GraphQL error.
       *
       * It did, and it cost an afternoon: `kind` was added to this insert and
       * deployed before `manual_apply_independent_clubs.sql` was applied, so
       * every enquiry threw on a missing column. Yoga masked the reason as
       * "Unexpected error.", ccaweb turns any GraphQL error into "the academy's
       * server did not answer", and the result was a form that looked like it
       * had a network problem for everyone, with nothing in any log naming the
       * column.
       *
       * So: log the real cause where an operator can find it, and answer with a
       * code the client can tell apart from a dead socket. The enquirer is told
       * their details were not saved rather than being shown a success they did
       * not get.
       */
      console.error(
        "[enquiry] create failed:",
        cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
      );
      return {
        ok: false,
        id: null,
        code: "ERROR",
        message:
          "Your enquiry could not be saved. This is our fault, not yours — please try again, or call the academy.",
      };
    }

    return { ok: true, id: created.id, code: "OK", message: THANKS };
  }

  /** Staff-only. The resolver gates on the admin token before calling this. */
  async list(args: { status?: EnquiryStatus | null; limit?: number | null; offset?: number | null }) {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const offset = Math.max(args.offset ?? 0, 0);
    const [items, total] = await this.repo.list({ status: args.status ?? null, limit, offset });
    return { items, total, limit, offset };
  }
}

function invalid(message: string): SchoolEnquiryResult {
  return { ok: false, id: null, code: "VALIDATION", message };
}

function rateLimited(): SchoolEnquiryResult {
  return {
    ok: false,
    id: null,
    code: "RATE_LIMITED",
    message:
      "We have already received several enquiries from here today. Please try again tomorrow, or email the academy directly.",
  };
}

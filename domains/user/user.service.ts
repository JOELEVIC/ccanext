import bcrypt from "bcryptjs";
import type { PrismaClient, User } from "@prisma/client";
import { UserRole, ClubStatus, MembershipRole, MembershipStatus } from "@prisma/client";
import { UserRepository } from "./user.repository";
import { verifyGoogleIdToken } from "@/domains/auth/googleVerify";
import type {
  CreateUserDTO,
  LoginDTO,
  AuthResponse,
  UpdateUserDTO,
  UpdateProfileDTO,
  UserFilters,
} from "./user.types";
import { generateToken } from "@/utils/jwt";
import { toPublicPlayer, type PublicPlayer } from "./publicPlayer";
import type { Viewer } from "./identityVisibility";
import { publicPlayerSelect } from "./publicPlayer.select";
import { AuthenticationError, ValidationError, NotFoundError } from "@/utils/types";

const SALT_ROUNDS = 12;

/**
 * The one spelling of an email address this API stores and matches on.
 *
 * `User.email` is `@unique` and Postgres compares strings case-sensitively, so
 * before this existed `Brenda@school.cm` and `brenda@school.cm` were two rows,
 * two ratings, two club memberships and — on a shared school handset — two
 * Drift wipes. That was not hypothetical: `googleVerify` has always lowercased
 * the address it reads out of the Google token, while `createUser` stored
 * whatever the person typed. So somebody who registered with a capital letter
 * and later tapped "Continue with Google" was silently handed a SECOND, empty
 * account on their own mailbox, and no error appeared anywhere.
 *
 * Trim as well as lowercase: a trailing space survives a copy-paste out of a
 * teacher's spreadsheet and is invisible in every UI that would show it.
 */
export function normaliseEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

export class UserService {
  private userRepository: UserRepository;

  constructor(private prisma: PrismaClient) {
    this.userRepository = new UserRepository(prisma);
  }

  /**
   * Find one account by email address, case-insensitively, WITHOUT a data
   * migration standing between this code and the rows already in production.
   *
   * `UserRepository.findByEmail` is a `findUnique` on a case-sensitive column.
   * Every account written from here on carries a normalised address, so the
   * unique index answers them exactly — that is the first lookup, and it is the
   * one that runs for every account created after this ships. The second lookup
   * exists purely for the mixed-case rows that predate normalisation, which
   * cannot be fixed from here: rewriting `users.email` in place is a production
   * data change, it needs a duplicate check first (two real accounts may already
   * collapse onto one address), and a human has to decide which of the two
   * survives. Until that cleanup runs, this method is what keeps those people
   * signing in.
   *
   * The JavaScript re-check on the second lookup is not belt-and-braces, it is
   * the correctness argument. Prisma compiles `mode: "insensitive"` to `ILIKE`
   * on Postgres, and `ILIKE` reads `%` and `_` in the VALUE as wildcards — and
   * `_` is an ordinary character in an email address. So `john_doe@x.cm` also
   * matches `johnXdoe@x.cm`. Treating the query as a superset and then keeping
   * only the rows whose normalised address is genuinely equal makes the result
   * correct whether or not Prisma escapes, which is not a thing worth depending
   * on a minor version for. Oldest row first so a pre-existing collision always
   * resolves to the same account rather than to whichever one the planner
   * returned today.
   */
  private async findUserByEmail(email: string): Promise<User | null> {
    const normalised = normaliseEmail(email);

    const exact = await this.prisma.user.findUnique({ where: { email: normalised } });
    if (exact) return exact;
    // An empty address still gets the exact lookup above — this endpoint does
    // not validate email format at all, so "" is a value that can be in the
    // column and a second registration of it must still read as "already in
    // use" rather than as a raw constraint error. It does NOT get the scan
    // below: `ILIKE ''` is a table read that can only ever return rows the
    // exact lookup already refused.
    if (!normalised) return null;

    const candidates = await this.prisma.user.findMany({
      where: { email: { equals: normalised, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
      take: 25,
    });
    return candidates.find((row) => normaliseEmail(row.email) === normalised) ?? null;
  }

  async createUser(data: CreateUserDTO): Promise<AuthResponse> {
    // Usernames must be a single handle — no spaces — so they're typeable,
    // @-mentionable, and safe to match (e.g. when seeding a tournament). The
    // rule applies to a username somebody CHOSE; an absent one is derived
    // below and is free and valid by construction.
    const chosenUsername = (data.username ?? "").trim();
    if (chosenUsername && !/^[A-Za-z0-9_]{3,20}$/.test(chosenUsername)) {
      throw new ValidationError(
        "Username must be 3–20 characters — letters, numbers and underscores only (no spaces).",
      );
    }

    const email = normaliseEmail(data.email);
    const existingEmail = await this.findUserByEmail(email);
    if (existingEmail) throw new ValidationError("Email already in use");

    // Derivation happens AFTER the duplicate-email check on purpose: somebody
    // registering an address they already hold is the commonest failure on this
    // endpoint, and `uniqueUsername` costs one SELECT per collision. There is no
    // point probing for a free handle for an account that is about to be
    // refused.
    const username = chosenUsername || (await this.uniqueUsername(email));

    // Only a CHOSEN username needs this. `uniqueUsername` has already proved its
    // answer free, so re-asking would be a wasted round trip — and it would not
    // close the race either way: two simultaneous registrations of the same
    // handle are separated by the unique index, not by this check. What this
    // check buys is the sentence, instead of a Prisma constraint error.
    if (chosenUsername) {
      const existingUsername = await this.userRepository.findByUsername(username);
      if (existingUsername) throw new ValidationError("Username already in use");
    }

    // A join code is resolved BEFORE the account exists: a typo must fail the
    // registration outright rather than leave someone signed up but attached to
    // nothing, believing they joined their school's club (BUILD_PLAN §6).
    const joinCode = data.joinCode?.trim();
    // `schoolId` is null for an independent club — the code still resolves, the
    // member still joins, there is simply no school to copy onto the account.
    let club: { id: string; schoolId: string | null } | null = null;
    if (joinCode) {
      club = await this.prisma.club.findFirst({
        where: { joinCode, status: { not: ClubStatus.ARCHIVED } },
        select: { id: true, schoolId: true },
      });
      if (!club) throw new ValidationError("That club code is not recognised.");
    }

    const passwordHash = bcrypt.hashSync(data.password, SALT_ROUNDS);

    const user = await this.userRepository.create({
      // Normalised, never the raw string: this is the write half of the pair
      // that stops one mailbox becoming two accounts. See `normaliseEmail`.
      email,
      username,
      passwordHash,
      role: data.role,
      // `User.schoolId` is legacy but must stay in sync with club affiliation
      // (BUILD_PLAN §2); club membership itself is read from ClubMembership.
      // `?? undefined` because an independent club has no school to copy: the
      // account simply carries none, which is what the legacy column means.
      schoolId: data.schoolId ?? club?.schoolId ?? undefined,
      profile: data.profile,
      // New accounts seed at an artificial rating of 100 and must complete placement;
      // the placement run then overwrites this with the estimated Elo.
      rating: 100,
      placementRequired: true,
    });

    // PENDING, not ACTIVE: holding the code proves which club, not that the
    // patron has admitted this person. The partial unique index on one ACTIVE
    // membership per user (BUILD_PLAN §2) is therefore never at risk here.
    if (club) {
      await this.prisma.clubMembership.create({
        data: {
          clubId: club.id,
          userId: user.id,
          role: MembershipRole.PLAYER,
          status: MembershipStatus.PENDING,
        },
      });
    }

    const token = generateToken(user.id, user.role);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        rating: user.rating,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  /**
   * The `publicPlayer(id)` query — BUILD_PLAN §6 and §4.3.
   *
   * Deliberately NOT `getUserById`: this returns the consent-reduced shape and
   * nothing else. `/players/[id]` renders strictly this (T1.13).
   */
  async getPublicPlayer(id: string): Promise<PublicPlayer | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: publicPlayerSelect,
    });
    return user ? toPublicPlayer(user) : null;
  }

  async authenticateUser(data: LoginDTO): Promise<AuthResponse> {
    // Case-insensitive, so the address the person types on a phone keyboard
    // that capitalises the first letter still finds the row they registered.
    const user = await this.findUserByEmail(data.email);
    if (!user) throw new AuthenticationError("Invalid email or password");

    const isPasswordValid = bcrypt.compareSync(
      data.password,
      user.passwordHash
    );
    if (!isPasswordValid)
      throw new AuthenticationError("Invalid email or password");

    const token = generateToken(user.id, user.role);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        rating: user.rating,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  /**
   * Sign in (or sign up) with a verified Google ID token. Finds the account by
   * email; if none exists, creates one from the Google profile with no usable
   * password (Google users authenticate via Google only). New accounts go
   * through placement like any other signup.
   */
  async loginWithGoogle(idToken: string): Promise<AuthResponse> {
    const profile = await verifyGoogleIdToken(idToken);
    if (!profile) throw new AuthenticationError("Google sign-in failed. Please try again.");

    // `verifyGoogleIdToken` already lowercases, and this normalises again — not
    // redundantly: this is the lookup that has to see the same address the
    // password path wrote, and routing both through one helper is what makes
    // "the same person" mean the same thing on both paths.
    const email = normaliseEmail(profile.email);
    let user = await this.findUserByEmail(email);
    if (!user) {
      const username = await this.uniqueUsername(email, profile.name);
      // No password login for Google accounts — store a random, unguessable hash.
      const passwordHash = bcrypt.hashSync(
        `google:${email}:${Date.now()}:${Math.random()}`,
        SALT_ROUNDS,
      );
      const parts = (profile.name ?? "").trim().split(/\s+/).filter(Boolean);
      const profileData = parts.length
        ? { firstName: parts[0], lastName: parts.slice(1).join(" ") || parts[0] }
        : undefined;
      user = await this.userRepository.create({
        email,
        username,
        passwordHash,
        role: UserRole.STUDENT,
        profile: profileData,
        rating: 100,
        placementRequired: true,
      });
    }

    const token = generateToken(user.id, user.role);
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        rating: user.rating,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  /**
   * A free, valid username derived from an email/name. Separators become
   * underscores (not deleted) and a number is appended until it's free:
   *   "john.doe@gmail.com"            -> "john_doe"
   *   "albert.einstein@…" (taken)     -> "albert_einstein2", "…3", …
   * The result always satisfies the username rule (3–20, [A-Za-z0-9_]).
   *
   * Written for Google sign-in and now serving password signup too, which is
   * why it is called from `createUser`. Nothing about its visibility had to
   * change for that: TypeScript's `private` restricts callers OUTSIDE the
   * class, and `createUser` is inside it.
   *
   * It probes rather than reserves, so the handle it returns is free at the
   * moment it answers and not a millisecond later. Two registrations racing on
   * the same email local-part are separated by the `@unique` index on
   * `users.username`, which surfaces as a Prisma error rather than as a
   * sentence — rare enough to accept, and cheaper than a reservation table.
   */
  private async uniqueUsername(email: string, name?: string): Promise<string> {
    let base = (email.split("@")[0] || name || "player")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_") // join dots / plus / etc. with a single underscore
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "");
    if (base.length < 3) base = `${base}player`;
    base = base.slice(0, 16) || "player";

    if (!(await this.userRepository.findByUsername(base))) return base;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base.slice(0, 20 - String(n).length)}${n}`;
      if (!(await this.userRepository.findByUsername(candidate))) return candidate;
    }
    return `${base.slice(0, 12)}${Date.now().toString().slice(-6)}`;
  }

  async getUserById(id: string) {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }

  /**
   * `Query.users`. The viewer is passed straight through: `search` may only
   * match `email` for a caller entitled to read it, and an unprivileged list is
   * capped. See `UserRepository.findMany`.
   *
   * `viewer` is optional so every existing caller keeps compiling — and omitting
   * it yields the ANONYMOUS (most restrictive) treatment, which is the safe way
   * round for a default.
   */
  async getUsers(filters?: UserFilters, viewer?: Viewer | null) {
    return this.userRepository.findMany(filters, viewer);
  }

  async updateUser(id: string, data: UpdateUserDTO) {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundError("User not found");

    // Normalise before comparing AND before writing. Comparing the raw string
    // against the stored one made "change your address to the same address in
    // different capitals" look like a change, and then wrote a second spelling
    // of the person's own mailbox into the column the whole auth path matches
    // on. `undefined` stays `undefined` — an update that does not mention email
    // must not blank it.
    const email = data.email === undefined ? undefined : normaliseEmail(data.email);

    if (email && email !== normaliseEmail(user.email)) {
      const existingEmail = await this.findUserByEmail(email);
      if (existingEmail) throw new ValidationError("Email already in use");
    }

    if (data.username && data.username !== user.username) {
      const existingUsername = await this.userRepository.findByUsername(
        data.username
      );
      if (existingUsername)
        throw new ValidationError("Username already in use");
    }

    return this.userRepository.update(id, { ...data, ...(email !== undefined ? { email } : {}) });
  }

  /**
   * Write a person's name onto their account — CREATING the Profile row if the
   * account has never had one.
   *
   * It used to throw `NotFoundError("User profile not found")` in that case,
   * and that was defensible only while every account was born with a profile.
   * It no longer is. A Profile row is created by `UserRepository.create` only
   * when the caller passes `profile`, so it is absent for every account made by
   * the two-field signup (email + password, no name asked), and absent for a
   * Google account whose Google name is a single word or empty. Those are
   * precisely the accounts the app then asks for a name — on the club-join
   * screen, at the moment a patron is about to look for the person on a roster.
   * Left as an update, that request could never succeed: the person would be
   * told to enter their name, enter it, and be refused forever, with no way in
   * the product to ever acquire the row that would let them try.
   *
   * `firstName` and `lastName` are NOT NULL on `profiles` with no default, so
   * the create branch supplies `""` for whichever half was not sent. An empty
   * string is the honest value — it says "we do not know this yet" — and it is
   * what the roster and team-sheet fallbacks (S5) are written against. It is
   * not a hole this method should paper over by refusing the write.
   *
   * `country` is left out of the create branch entirely when unsent so the
   * column default ("CM") applies rather than being overwritten with undefined.
   *
   * Straight to Prisma rather than through `UserRepository.updateProfile`
   * because that method is a bare `profile.update` and the repository is owned
   * elsewhere this cycle; the upsert belongs with the rule it enforces anyway.
   */
  async updateProfile(userId: string, data: UpdateProfileDTO) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("User not found");

    return this.prisma.profile.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
      },
    });
  }

  async updateUserRating(userId: string, newRating: number) {
    if (newRating < 0 || newRating > 3000)
      throw new ValidationError("Rating must be between 0 and 3000");
    return this.userRepository.updateRating(userId, newRating);
  }

  calculateEloRating(
    currentRating: number,
    opponentRating: number,
    score: number
  ): number {
    const K = currentRating < 2100 ? 32 : currentRating < 2400 ? 24 : 16;
    const expectedScore =
      1 / (1 + Math.pow(10, (opponentRating - currentRating) / 400));
    const newRating = Math.round(
      currentRating + K * (score - expectedScore)
    );
    return Math.max(0, Math.min(3000, newRating));
  }
}

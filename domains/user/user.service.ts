import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
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

export class UserService {
  private userRepository: UserRepository;

  constructor(private prisma: PrismaClient) {
    this.userRepository = new UserRepository(prisma);
  }

  async createUser(data: CreateUserDTO): Promise<AuthResponse> {
    // Usernames must be a single handle — no spaces — so they're typeable,
    // @-mentionable, and safe to match (e.g. when seeding a tournament).
    const username = (data.username ?? "").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      throw new ValidationError(
        "Username must be 3–20 characters — letters, numbers and underscores only (no spaces).",
      );
    }

    const existingEmail = await this.userRepository.findByEmail(data.email);
    if (existingEmail) throw new ValidationError("Email already in use");

    const existingUsername = await this.userRepository.findByUsername(username);
    if (existingUsername) throw new ValidationError("Username already in use");

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
      email: data.email,
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
    const user = await this.userRepository.findByEmail(data.email);
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

    let user = await this.userRepository.findByEmail(profile.email);
    if (!user) {
      const username = await this.uniqueUsername(profile.email, profile.name);
      // No password login for Google accounts — store a random, unguessable hash.
      const passwordHash = bcrypt.hashSync(
        `google:${profile.email}:${Date.now()}:${Math.random()}`,
        SALT_ROUNDS,
      );
      const parts = (profile.name ?? "").trim().split(/\s+/).filter(Boolean);
      const profileData = parts.length
        ? { firstName: parts[0], lastName: parts.slice(1).join(" ") || parts[0] }
        : undefined;
      user = await this.userRepository.create({
        email: profile.email,
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
   * A free, valid username derived from a Google email/name. Separators become
   * underscores (not deleted) and a number is appended until it's free:
   *   "john.doe@gmail.com"            -> "john_doe"
   *   "albert.einstein@…" (taken)     -> "albert_einstein2", "…3", …
   * The result always satisfies the username rule (3–20, [A-Za-z0-9_]).
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

    if (data.email && data.email !== user.email) {
      const existingEmail = await this.userRepository.findByEmail(data.email);
      if (existingEmail) throw new ValidationError("Email already in use");
    }

    if (data.username && data.username !== user.username) {
      const existingUsername = await this.userRepository.findByUsername(
        data.username
      );
      if (existingUsername)
        throw new ValidationError("Username already in use");
    }

    return this.userRepository.update(id, data);
  }

  async updateProfile(userId: string, data: UpdateProfileDTO) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("User not found");
    if (!user.profile) throw new NotFoundError("User profile not found");
    return this.userRepository.updateProfile(userId, data);
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

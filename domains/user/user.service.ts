import bcrypt from "bcrypt";
import type { PrismaClient } from "@prisma/client";
import { UserRepository } from "./user.repository";
import type {
  CreateUserDTO,
  LoginDTO,
  AuthResponse,
  UpdateUserDTO,
  UpdateProfileDTO,
  UserFilters,
} from "./user.types";
import { generateToken } from "@/utils/jwt";
import { AuthenticationError, ValidationError, NotFoundError } from "@/utils/types";

const SALT_ROUNDS = 12;

export class UserService {
  private userRepository: UserRepository;

  constructor(prisma: PrismaClient) {
    this.userRepository = new UserRepository(prisma);
  }

  async createUser(data: CreateUserDTO): Promise<AuthResponse> {
    const existingEmail = await this.userRepository.findByEmail(data.email);
    if (existingEmail) throw new ValidationError("Email already in use");

    const existingUsername = await this.userRepository.findByUsername(
      data.username
    );
    if (existingUsername) throw new ValidationError("Username already in use");

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    const user = await this.userRepository.create({
      email: data.email,
      username: data.username,
      passwordHash,
      role: data.role,
      schoolId: data.schoolId,
      profile: data.profile,
    });

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

  async authenticateUser(data: LoginDTO): Promise<AuthResponse> {
    const user = await this.userRepository.findByEmail(data.email);
    if (!user) throw new AuthenticationError("Invalid email or password");

    const isPasswordValid = await bcrypt.compare(
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

  async getUserById(id: string) {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }

  async getUsers(filters?: UserFilters) {
    return this.userRepository.findMany(filters);
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

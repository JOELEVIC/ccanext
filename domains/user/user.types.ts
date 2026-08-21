import type { UserRole } from "@prisma/client";

export interface CreateUserDTO {
  email: string;
  username: string;
  password: string;
  role: UserRole;
  schoolId?: string;
  /**
   * Optional club join code (BUILD_PLAN §6: "register … extend with optional
   * joinCode"). Validated before the account is created, so a typo never leaves
   * a user registered but unattached. Creates a PENDING membership — the patron
   * still admits them.
   */
  joinCode?: string;
  profile?: {
    firstName: string;
    lastName: string;
    dateOfBirth?: Date;
    country?: string;
  };
}

export interface UpdateUserDTO {
  email?: string;
  username?: string;
  schoolId?: string;
  rating?: number;
}

export interface UpdateProfileDTO {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: Date;
  country?: string;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    username: string;
    role: UserRole;
    rating: number;
    createdAt: Date;
    updatedAt: Date;
  };
}

export interface UserFilters {
  role?: UserRole;
  schoolId?: string;
  search?: string;
}

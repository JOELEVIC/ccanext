import type { UserRole } from "@prisma/client";

export interface CreateUserDTO {
  email: string;
  /**
   * OPTIONAL, and the reason signup is two fields instead of five.
   *
   * A username is a handle the account needs, not a decision the person joining
   * has to make: asking for one at the door means asking somebody who has not
   * seen the app yet to invent a name, and then rejecting it because a stranger
   * already has it. When it is absent, `UserService.createUser` derives a free
   * one with `uniqueUsername()` — the same helper `loginWithGoogle` has always
   * used, so a password signup and a Google signup now produce handles of the
   * same shape.
   *
   * Still accepted, and still validated when supplied, because it is not gone
   * from any client: `ccaweb`, `ccaui` and every APK already in a pocket send a
   * username on every register, and they will keep doing so for as long as they
   * are installed.
   */
  username?: string;
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

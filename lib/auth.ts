// Request is the standard Web API Request (fetch spec)
import { extractTokenFromHeader, verifyToken, verifyAdminToken } from "@/utils/jwt";
import type { AuthContext } from "@/utils/types";

export interface AdminAuthContext {
  adminId: string;
  role: string; // "ROOT" | "ADMIN"
}

/**
 * Extract and verify JWT from Request, return AuthContext or undefined.
 * Does not throw - returns undefined if no token or invalid.
 */
export async function optionalAuthenticate(
  request: { headers: { get: (name: string) => string | null } }
): Promise<AuthContext | undefined> {
  try {
    const authHeader = request.headers.get("authorization");
    const token = extractTokenFromHeader(authHeader ?? undefined);
    if (!token) return undefined;
    const payload = verifyToken(token);
    return { userId: payload.userId, role: payload.role };
  } catch {
    return undefined;
  }
}

/**
 * Verify an ADMIN token (separate signing key). Returns undefined for player
 * tokens or no token — admin and player auth never collide.
 */
export async function optionalAdminAuthenticate(
  request: { headers: { get: (name: string) => string | null } }
): Promise<AdminAuthContext | undefined> {
  try {
    const authHeader = request.headers.get("authorization");
    const token = extractTokenFromHeader(authHeader ?? undefined);
    if (!token) return undefined;
    const payload = verifyAdminToken(token);
    return { adminId: payload.adminId, role: payload.role };
  } catch {
    return undefined;
  }
}

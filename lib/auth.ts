// Request is the standard Web API Request (fetch spec)
import { extractTokenFromHeader, verifyToken } from "@/utils/jwt";
import type { AuthContext } from "@/utils/types";

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

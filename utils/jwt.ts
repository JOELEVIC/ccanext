import jwt from "jsonwebtoken";
import { config } from "@/config/env";
import type { JWTPayload } from "@/utils/types";
import { AuthenticationError } from "@/utils/types";

export function generateToken(userId: string, role: string): string {
  const payload: JWTPayload = { userId, role };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, config.jwt.secret) as JWTPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError("Token has expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthenticationError("Invalid token");
    }
    throw new AuthenticationError("Token verification failed");
  }
}

export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

// ---------------------------------------------------------------------------
// Admin tokens — signed with a SEPARATE key (config.adminJwt) and tagged
// `kind: "admin"` so a player token can never be accepted as an admin token
// (different signing key already guarantees this; the tag is belt-and-braces).
// ---------------------------------------------------------------------------

export interface AdminJWTPayload {
  adminId: string;
  role: string; // "ROOT" | "ADMIN"
  kind: "admin";
  iat?: number;
  exp?: number;
}

export function generateAdminToken(adminId: string, role: string): string {
  const payload = { adminId, role, kind: "admin" as const };
  return jwt.sign(payload, config.adminJwt.secret, {
    expiresIn: config.adminJwt.expiresIn,
  } as jwt.SignOptions);
}

export function verifyAdminToken(token: string): AdminJWTPayload {
  try {
    const payload = jwt.verify(token, config.adminJwt.secret) as AdminJWTPayload;
    if (payload.kind !== "admin") {
      throw new AuthenticationError("Not an admin token");
    }
    return payload;
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError("Admin session has expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthenticationError("Invalid admin token");
    }
    throw new AuthenticationError("Admin token verification failed");
  }
}

import { SignJWT, jwtVerify } from "jose";
import type { AdminRole } from "./db/admin-users";

export const ADMIN_SESSION_COOKIE_NAME = "finbra_admin_session";
const SESSION_DURATION = "12h";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function getSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error("ADMIN_JWT_SECRET no está configurado");
  }
  return new TextEncoder().encode(secret);
}

export interface AdminSessionPayload {
  email: string;
  nombre: string;
  role: AdminRole;
}

export async function signAdminSession(payload: AdminSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecret());
}

export async function verifyAdminSession(token: string): Promise<AdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const { email, nombre, role } = payload;
    if (typeof email !== "string" || typeof nombre !== "string" || typeof role !== "string") {
      return null;
    }
    return { email, nombre, role: role as AdminRole };
  } catch {
    return null;
  }
}

export const ADMIN_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

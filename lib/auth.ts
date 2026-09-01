import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "finbra_session";
const SESSION_DURATION = "7d";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET no está configurado");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  email: string;
  brokerId: string;
  nombre: string;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const { email, brokerId, nombre } = payload;
    if (typeof email !== "string" || typeof brokerId !== "string" || typeof nombre !== "string") {
      return null;
    }
    return { email, brokerId, nombre };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

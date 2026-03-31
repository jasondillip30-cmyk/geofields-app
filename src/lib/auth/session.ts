import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { NextRequest, NextResponse } from "next/server";

import type { UserRole } from "@/lib/types";

export const SESSION_COOKIE_NAME = "gf_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface AuthSession {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
}

interface SessionJwtPayload extends JWTPayload, AuthSession {}

function getJwtSecret() {
  const secret = process.env.AUTH_SECRET || "dev-secret-change-me";
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(session: AuthSession) {
  return new SignJWT(session as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<AuthSession | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const typed = payload as unknown as SessionJwtPayload;
    if (!typed.userId || !typed.role || !typed.email || !typed.name) {
      return null;
    }
    return {
      userId: typed.userId,
      email: typed.email,
      name: typed.name,
      role: typed.role
    };
  } catch (_error) {
    return null;
  }
}

export async function getSessionFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  return verifySessionToken(token);
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

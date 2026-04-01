import { compare } from "bcryptjs";
import { NextResponse } from "next/server";

import { AuthConfigurationError } from "@/lib/auth/secret";
import { signSessionToken, setSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ message: "Email and password are required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user || !user.isActive) {
    return NextResponse.json({ message: "Invalid login credentials." }, { status: 401 });
  }

  const passwordMatches = await compare(password, user.passwordHash);
  if (!passwordMatches) {
    return NextResponse.json({ message: "Invalid login credentials." }, { status: 401 });
  }

  let token: string;
  try {
    token = await signSessionToken({
      userId: user.id,
      email: user.email,
      name: user.fullName,
      role: user.role
    });
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return NextResponse.json(
        { message: "Server auth configuration error: missing AUTH_SECRET." },
        { status: 500 }
      );
    }
    throw error;
  }

  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.fullName,
      email: user.email,
      role: user.role
    }
  });

  setSessionCookie(response, token);
  return response;
}

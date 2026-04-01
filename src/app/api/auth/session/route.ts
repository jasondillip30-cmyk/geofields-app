import { NextResponse, type NextRequest } from "next/server";

import { AuthConfigurationError } from "@/lib/auth/secret";
import { getSessionFromRequest } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  let session = null;
  try {
    session = await getSessionFromRequest(request);
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return NextResponse.json(
        { message: "Server auth configuration error: missing AUTH_SECRET." },
        { status: 500 }
      );
    }
    throw error;
  }

  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ user: session });
}

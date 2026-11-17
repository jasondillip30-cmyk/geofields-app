import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSafetyReviewerEligible } from "@/lib/safety-incident-policy";

export const safetyResponse = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export class SafetyInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function safetyFailure(error: unknown) {
  return error instanceof SafetyInputError
    ? safetyResponse({ message: error.message }, error.status)
    : safetyResponse({ message: "The safety record could not be saved or loaded. Try again." }, 500);
}

export async function safetyActor(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) throw new SafetyInputError("Sign in to continue.", 401);
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true, isActive: true, isSafetyReviewer: true }
  });
  if (!user?.isActive) throw new SafetyInputError("This account is not active.", 403);
  return {
    id: user.id,
    canCoordinate: user.role === "OFFICE",
    canReview: user.isSafetyReviewer && isSafetyReviewerEligible(user.role, user.isActive)
  };
}

export async function safetyBody(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SafetyInputError("Enter the report details.");
  return body as Record<string, unknown>;
}

export function safetyText(value: unknown, label: string, max: number, required = false): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max || (required && !text)) {
    throw new SafetyInputError(`Enter ${label} (${max} characters or fewer).`);
  }
  return text;
}

export function safetyDate(value: unknown, label: string, dateOnly = false) {
  const text = safetyText(value, label, 35, true);
  const pattern = dateOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const date = new Date(dateOnly ? text + "T00:00:00.000Z" : text);
  if (!pattern.test(text) || !Number.isFinite(date.getTime()) ||
      (dateOnly ? date.toISOString().slice(0, 10) : date.toISOString()) !== text) {
    throw new SafetyInputError(`Enter a valid ${label}.`);
  }
  return date;
}

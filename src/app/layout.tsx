import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import "@/app/globals.css";
import { RootFrame } from "@/components/layout/root-frame";
import { RoleProvider } from "@/components/layout/role-provider";
import { AuthConfigurationError } from "@/lib/auth/secret";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-config";
import { verifySessionToken } from "@/lib/auth/session";
import type { UserRole } from "@/lib/types";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap"
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap"
});

export const metadata: Metadata = {
  title: "GeoFields Operations Dashboard",
  description:
    "Internal operations intelligence platform for drilling activities, finance tracking, rig performance, and maintenance workflows."
};

export default async function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const initialUser = await resolveInitialRoleUser();

  return (
    <html lang="en">
      <body className={`${manrope.variable} ${spaceGrotesk.variable} antialiased`}>
        <RoleProvider initialUser={initialUser}>
          <RootFrame>{children}</RootFrame>
        </RoleProvider>
      </body>
    </html>
  );
}

async function resolveInitialRoleUser(): Promise<{
  id: string;
  name: string;
  email: string;
  role: UserRole;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  try {
    const session = await verifySessionToken(token);
    if (!session) {
      return null;
    }

    return {
      id: session.userId,
      name: session.name,
      email: session.email,
      role: session.role
    };
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      console.error("[layout] failed to resolve initial role user: missing auth secret");
      return null;
    }
    throw error;
  }
}

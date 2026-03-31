import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { RootFrame } from "@/components/layout/root-frame";
import { RoleProvider } from "@/components/layout/role-provider";

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

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${spaceGrotesk.variable} antialiased`}>
        <RoleProvider>
          <RootFrame>{children}</RootFrame>
        </RoleProvider>
      </body>
    </html>
  );
}

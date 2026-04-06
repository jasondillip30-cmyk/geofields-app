import type { UserRole } from "@/lib/types";

export interface AuthSession {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
}


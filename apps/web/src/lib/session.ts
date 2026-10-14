import { cookies } from "next/headers";
import { apiFetch } from "./api";

export const TOKEN_COOKIE = "gfp_token";

export type Role = "USER" | "ADMIN" | "SUPER_ADMIN";
export type UserStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

export interface SessionUser {
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  email_verified: boolean;
  mfa_enabled: boolean;
}

export async function getToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(TOKEN_COOKIE)?.value ?? null;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await getToken();
  if (!token) return null;
  const res = await apiFetch<{ user: SessionUser }>("/auth/me", { token });
  if (!res.ok || !res.data) return null;
  return res.data.user;
}

export function isAdmin(user: SessionUser | null): boolean {
  return (
    !!user &&
    user.status === "APPROVED" &&
    (user.role === "ADMIN" || user.role === "SUPER_ADMIN")
  );
}

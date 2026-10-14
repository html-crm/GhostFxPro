"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { apiFetch } from "./api";
import { TOKEN_COOKIE, getToken } from "./session";

export interface FormState {
  error?: string;
  ok?: boolean;
}

const SESSION_MAX_AGE = 60 * 60 * 12;

async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const totp = String(formData.get("totp") ?? "").trim();
  if (!email || !password) return { error: "Email and password are required." };

  const res = await apiFetch<{ token: string; error?: string }>("/auth/login", {
    method: "POST",
    body: { email, password, ...(totp ? { totp } : {}) },
  });

  if (!res.ok || !res.data) {
    if (res.status === 0) return { error: "Cannot reach the API. Is it running?" };
    const code = (res.data as { error?: string } | null)?.error ?? "login_failed";
    if (code === "mfa_required") return { error: "Enter your 6-digit MFA code." };
    if (code === "mfa_invalid") return { error: "Invalid MFA code." };
    if (code === "invalid_credentials") return { error: "Invalid email or password." };
    if (code.startsWith("account_")) return { error: "This account is not permitted to sign in." };
    return { error: "Sign in failed." };
  }

  await setSessionCookie(res.data.token);
  redirect("/dashboard");
}

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!displayName || !email || !password) {
    return { error: "All fields are required." };
  }

  const reg = await apiFetch<{ error?: string }>("/auth/register", {
    method: "POST",
    body: { displayName, email, password },
  });
  if (!reg.ok) {
    if (reg.status === 0) return { error: "Cannot reach the API. Is it running?" };
    const code = (reg.data as { error?: string } | null)?.error;
    if (code === "email_taken") return { error: "That email is already registered." };
    if (code === "weak_password") return { error: "Password must be at least 8 characters." };
    if (code === "invalid_email") return { error: "Enter a valid email address." };
    return { error: "Registration failed." };
  }

  const login = await apiFetch<{ token: string }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (login.ok && login.data) {
    await setSessionCookie(login.data.token);
    redirect("/dashboard");
  }
  redirect("/login");
}

export async function logoutAction(): Promise<void> {
  const token = await getToken();
  if (token) await apiFetch("/auth/logout", { method: "POST", token });
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  redirect("/login");
}

export interface MfaSetupResult {
  secret?: string;
  otpauthUri?: string;
  error?: string;
}

export async function mfaSetupAction(): Promise<MfaSetupResult> {
  const token = await getToken();
  if (!token) return { error: "not_authenticated" };
  const res = await apiFetch<{ secret: string; otpauthUri: string }>(
    "/auth/mfa/setup",
    { method: "POST", token },
  );
  if (!res.ok || !res.data) return { error: "Could not start MFA setup." };
  return { secret: res.data.secret, otpauthUri: res.data.otpauthUri };
}

export async function mfaConfirmAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = await getToken();
  if (!token) return { error: "not_authenticated" };
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Enter the 6-digit code." };
  const res = await apiFetch("/auth/mfa/confirm", {
    method: "POST",
    token,
    body: { code },
  });
  if (!res.ok) return { error: "Invalid code. Check your authenticator and retry." };
  revalidatePath("/settings");
  return { ok: true };
}

async function adminAction(
  userId: string,
  action: "approve" | "reject" | "suspend" | "restore" | "revoke-sessions",
): Promise<void> {
  const token = await getToken();
  if (!token) redirect("/login");
  const path =
    action === "revoke-sessions"
      ? `/admin/users/${userId}/revoke-sessions`
      : `/admin/users/${userId}/${action}`;
  await apiFetch(path, { method: "POST", token });
  revalidatePath("/admin/users");
}

export async function approveUserAction(formData: FormData): Promise<void> {
  await adminAction(String(formData.get("userId")), "approve");
}
export async function rejectUserAction(formData: FormData): Promise<void> {
  await adminAction(String(formData.get("userId")), "reject");
}
export async function suspendUserAction(formData: FormData): Promise<void> {
  await adminAction(String(formData.get("userId")), "suspend");
}
export async function restoreUserAction(formData: FormData): Promise<void> {
  await adminAction(String(formData.get("userId")), "restore");
}
export async function revokeSessionsAction(formData: FormData): Promise<void> {
  await adminAction(String(formData.get("userId")), "revoke-sessions");
}
export async function changeRoleAction(formData: FormData): Promise<void> {
  const token = await getToken();
  if (!token) redirect("/login");
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role"));
  await apiFetch(`/admin/users/${userId}/role`, {
    method: "POST",
    token,
    body: { role },
  });
  revalidatePath("/admin/users");
}

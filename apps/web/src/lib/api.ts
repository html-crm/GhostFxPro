export const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
}

export interface ApiError {
  error: string;
  message?: string;
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: {
    method?: string;
    token?: string | null;
    body?: unknown;
  } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, data: null };
  }

  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

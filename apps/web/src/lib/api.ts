/**
 * Thin API client for the HYRTE gateway.
 *
 * Attaches the access token, transparently refreshes it once on a 401, and
 * surfaces a typed error. Requests go through Next's /api rewrite to the
 * NestJS gateway.
 */
import { useAuthStore } from '@/store/auth';

const BASE = '/api';

export class ApiError extends Error {
  // P1 — carries the full `error` envelope (see all-exceptions.filter.ts),
  // not just `.message`, so callers can read structured fields like
  // request-otp's `retryAfterSec` without a second parsing pass.
  constructor(public status: number, message: string, public body?: Record<string, unknown>) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const { accessToken, refreshToken, setTokens, logout } = useAuthStore.getState();

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && retry && refreshToken) {
    // Attempt a single refresh, then replay the original request.
    const r = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (r.ok) {
      const data = await r.json();
      setTokens(data.accessToken, data.refreshToken);
      return request<T>(path, init, false);
    }
    logout();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.message ?? res.statusText, body?.error);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
};

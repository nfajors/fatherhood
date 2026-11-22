/**
 * Calls to the website's API with the member's session token. A 401 means the
 * session ended (signed out elsewhere, or expired): the app returns to sign in.
 */
import { API_URL } from "../config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** No connection, or the server couldn't be reached. */
  get offline() {
    return this.status === 0;
  }
}

let token: string | null = null;
let onSignedOut: (() => void) | null = null;

export function setSession(next: string | null, signedOut?: () => void) {
  token = next;
  if (signedOut) onSignedOut = signedOut;
}

export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

const FALLBACK: Record<number, string> = {
  401: "Please sign in again.",
  403: "This is for members.",
  404: "We couldn't find that.",
  429: "That's the limit for today. Try again tomorrow.",
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; text?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": init.text ? "text/plain" : "application/json" }),
        ...authHeaders(),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, "offline", "You're offline. Downloaded videos still play.");
  }
  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && token) onSignedOut?.();
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? FALLBACK[res.status] ?? "Something went wrong. Please try again.");
  }
  return data as T;
}

import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { newId, now, randomTokenHex, sha256Hex } from "./util";

export const SESSION_COOKIE = "notetion_session";
export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface Account {
  id: string;
  username: string;
  role: string;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Production cookies use the `__Host-` prefix (requires Secure + Path=/ + no Domain).
 * Local dev runs on http://localhost where `Secure` cookies are awkward, so we
 * fall back to the plain name there.
 */
export function sessionCookieName(hostname: string): string {
  return isLocalHost(hostname) ? SESSION_COOKIE : `__Host-${SESSION_COOKIE}`;
}

export function sessionCookieHeader(hostname: string, token: string, maxAgeSeconds: number): string {
  const parts = [
    `${sessionCookieName(hostname)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
  ];
  if (!isLocalHost(hostname)) parts.push("Secure");
  return parts.join("; ");
}

export function readSessionToken(c: Context): string | null {
  const hostname = new URL(c.req.url).hostname;
  // In production only the `__Host-` cookie counts: it cannot be set by a sibling subdomain.
  // The plain name is accepted on localhost only (dev).
  return getCookie(c, sessionCookieName(hostname)) ?? null;
}

export async function createSession(db: D1Database, accountId: string, userAgent: string | null): Promise<string> {
  const token = randomTokenHex(32);
  const ts = now();
  await db
    .prepare(
      `INSERT INTO sessions (id, token_hash, account_id, created_at, expires_at, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(newId(), await sha256Hex(token), accountId, ts, ts + SESSION_TTL_MS, userAgent?.slice(0, 200) ?? null)
    .run();
  return token;
}

export async function resolveAccount(db: D1Database, token: string | null): Promise<Account | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT a.id, a.username, a.role, s.expires_at
         FROM sessions s
         JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<{ id: string; username: string; role: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < now()) {
    await db.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(tokenHash).run();
    return null;
  }
  return { id: row.id, username: row.username, role: row.role };
}

export async function destroySession(db: D1Database, token: string | null): Promise<void> {
  if (!token) return;
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(await sha256Hex(token)).run();
}

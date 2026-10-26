import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Account } from "./session";
import {
  createSession,
  destroySession,
  readSessionToken,
  resolveAccount,
  sessionCookieHeader,
  SESSION_TTL_DAYS,
} from "./session";
import { newId, now, safeEqualSecret } from "./util";
import { seedStarterNotes } from "./seed";

export type AppEnv = {
  Bindings: Env;
  Variables: { account: Account };
};

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const account = await resolveAccount(c.env.DB, readSessionToken(c));
  if (!account) return c.json({ error: "unauthorized" }, 401);
  c.set("account", account);
  await next();
});

export async function loadSettings(db: D1Database, accountId: string): Promise<Record<string, string>> {
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE account_id = ?1`)
    .bind(accountId)
    .all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const row of results ?? []) out[row.key] = row.value;
  return out;
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const adminUser = (c.env.ADMIN_USERNAME ?? "admin").trim();
  const adminPass = c.env.ADMIN_PASSWORD;
  if (!adminPass) {
    return c.json({ error: "server_misconfigured", detail: "ADMIN_PASSWORD is not set" }, 500);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return c.json({ error: "missing_credentials" }, 400);
  }

  const okUser = await safeEqualSecret(username.trim(), adminUser);
  const okPass = await safeEqualSecret(password, adminPass);
  if (!okUser || !okPass) return c.json({ error: "invalid_credentials" }, 401);

  const db = c.env.DB;
  const ts = now();
  let account = await db
    .prepare(`SELECT id, username, role FROM accounts WHERE username = ?1`)
    .bind(adminUser)
    .first<Account>();
  let seeded = false;

  if (!account) {
    // First successful login creates the sole admin account and seeds the two
    // standard starter notes (Traditional Chinese + English).
    const id = newId();
    await db
      .prepare(`INSERT INTO accounts (id, username, role, created_at, last_login_at) VALUES (?1, ?2, 'admin', ?3, ?3)`)
      .bind(id, adminUser, ts)
      .run();
    await seedStarterNotes(db, id, ts);
    account = { id, username: adminUser, role: "admin" };
    seeded = true;
  } else {
    await db.prepare(`UPDATE accounts SET last_login_at = ?2 WHERE id = ?1`).bind(account.id, ts).run();
  }

  const token = await createSession(db, account.id, c.req.header("user-agent") ?? null);
  const hostname = new URL(c.req.url).hostname;
  c.header("Set-Cookie", sessionCookieHeader(hostname, token, SESSION_TTL_DAYS * 24 * 60 * 60));

  const settings = await loadSettings(db, account.id);
  return c.json({ account, settings, seeded });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c.env.DB, readSessionToken(c));
  const hostname = new URL(c.req.url).hostname;
  c.header("Set-Cookie", sessionCookieHeader(hostname, "", 0));
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  const account = c.get("account");
  const settings = await loadSettings(c.env.DB, account.id);
  return c.json({ account, settings });
});

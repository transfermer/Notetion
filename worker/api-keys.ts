import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { newId, now, randomTokenHex, sha256Hex } from "./util";

export const apiKeysRoutes = new Hono<AppEnv>();
apiKeysRoutes.use("*", requireAuth);

const KEY_PREFIX = "ink_";
const KEY_LENGTH = 32; // bytes → 64 hex chars
const VALID_PERMISSIONS = new Set(["read", "write", "delete", "trash"]);

function sanitizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return ["read"];
  const out = new Set<string>();
  for (const p of input) {
    if (typeof p === "string" && VALID_PERMISSIONS.has(p)) out.add(p);
  }
  return out.size ? [...out] : ["read"];
}

interface ApiKey {
  id: string;
  name: string;
  permissions: string[];
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

interface ApiKeyWithToken extends ApiKey {
  token: string; // Only returned once on creation.
}

// GET /api/api-keys
apiKeysRoutes.get("/", async (c) => {
  const accountId = c.get("account").id;
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, permissions, created_at, last_used_at, expires_at, revoked_at
       FROM api_keys
      WHERE account_id = ?1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
  )
    .bind(accountId)
    .all();
  return c.json({ keys: (results ?? []).map((r: any) => ({ ...r, permissions: JSON.parse(r.permissions) })) });
});

// POST /api/api-keys
apiKeysRoutes.post("/", async (c) => {
  const accountId = c.get("account").id;
  const body = (await c.req.json().catch(() => null)) as { name?: unknown; permissions?: unknown; expires_in_days?: unknown } | null;

  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "Unnamed key";
  const permissions = sanitizePermissions(body?.permissions);
  const expiresInDays = typeof body?.expires_in_days === "number" ? body.expires_in_days : null;

  const token = KEY_PREFIX + randomTokenHex(KEY_LENGTH);
  const tokenHash = await sha256Hex(token);
  const ts = now();
  const expiresAt = expiresInDays ? ts + expiresInDays * 24 * 60 * 60 * 1000 : null;

  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, account_id, key_hash, name, permissions, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, accountId, tokenHash, name, JSON.stringify(permissions), ts, expiresAt)
    .run();

  const key: ApiKeyWithToken = {
    id,
    name,
    permissions,
    created_at: ts,
    last_used_at: null,
    expires_at: expiresAt,
    revoked_at: null,
    token,
  };

  return c.json({ key }, 201);
});

// DELETE /api/api-keys/:id
apiKeysRoutes.delete("/:id", async (c) => {
  const accountId = c.get("account").id;
  const id = c.req.param("id");

  const res = await c.env.DB.prepare(
    `UPDATE api_keys SET revoked_at = ?3 WHERE id = ?1 AND account_id = ?2 AND revoked_at IS NULL`,
  )
    .bind(id, accountId, now())
    .run();

  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/**
 * Middleware to authenticate API requests via API key or OAuth token.
 * Checks Authorization: Bearer ink_... or Bearer <oauth_token>.
 */
export async function authenticateApiRequest(
  db: D1Database,
  authHeader: string | null,
): Promise<{ accountId: string; permissions: string[]; authType: "api_key" | "oauth" } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const tokenHash = await sha256Hex(token);

  // Try API key first.
  const apiKey = await db.prepare(
    `SELECT id, account_id, permissions, last_used_at, expires_at, revoked_at
       FROM api_keys
      WHERE key_hash = ?1`,
  )
    .bind(tokenHash)
    .first<{ id: string; account_id: string; permissions: string; last_used_at: number | null; expires_at: number | null; revoked_at: number | null }>();

  if (apiKey && !apiKey.revoked_at && (!apiKey.expires_at || apiKey.expires_at > now())) {
    // Update last_used_at (fire-and-forget).
    db.prepare(`UPDATE api_keys SET last_used_at = ?2 WHERE id = ?1`)
      .bind(apiKey.id, now())
      .run()
      .catch(() => {});

    return {
      accountId: apiKey.account_id,
      permissions: sanitizePermissions(JSON.parse(apiKey.permissions)),
      authType: "api_key",
    };
  }

  // Try OAuth access token; also verify the underlying grant is not revoked.
  const oauthToken = await db.prepare(
    `SELECT t.id, t.account_id, t.scope, t.expires_at, t.client_id,
            g.revoked_at AS grant_revoked
       FROM oauth_tokens t
       LEFT JOIN oauth_grants g ON g.client_id = t.client_id AND g.account_id = t.account_id
      WHERE t.access_token_hash = ?1`,
  )
    .bind(tokenHash)
    .first<{ id: string; account_id: string; scope: string; expires_at: number; client_id: string; grant_revoked: number | null }>();

  if (oauthToken && oauthToken.expires_at > now() && oauthToken.grant_revoked === null) {
    // OAuth scopes are space-separated (RFC 6749); accept comma for leniency.
    const perms = oauthToken.scope.split(/[\s,]+/).filter((p) => VALID_PERMISSIONS.has(p));
    return {
      accountId: oauthToken.account_id,
      permissions: perms.length ? perms : ["read"],
      authType: "oauth",
    };
  }

  return null;
}

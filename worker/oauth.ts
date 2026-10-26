import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { newId, now, randomTokenHex, sha256Hex } from "./util";

export const oauthRoutes = new Hono<AppEnv>();
oauthRoutes.use("*", requireAuth);

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// GET /api/oauth/clients
oauthRoutes.get("/clients", async (c) => {
  const accountId = c.get("account").id;
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, redirect_uri, created_at
       FROM oauth_clients
      WHERE account_id = ?1
      ORDER BY created_at DESC`,
  )
    .bind(accountId)
    .all();
  return c.json({ clients: results ?? [] });
});

// POST /api/oauth/clients
oauthRoutes.post("/clients", async (c) => {
  const accountId = c.get("account").id;
  const body = (await c.req.json().catch(() => null)) as { name?: unknown; redirect_uri?: unknown } | null;

  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : null;
  const redirectUri = typeof body?.redirect_uri === "string" && body.redirect_uri.trim() ? body.redirect_uri.trim() : null;

  if (!name || !redirectUri) return c.json({ error: "name_and_redirect_required" }, 400);

  const clientSecret = randomTokenHex(32);
  const clientSecretHash = await sha256Hex(clientSecret);
  const ts = now();
  const id = newId();

  await c.env.DB.prepare(
    `INSERT INTO oauth_clients (id, account_id, name, redirect_uri, client_secret_hash, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, accountId, name, redirectUri, clientSecretHash, ts)
    .run();

  return c.json({ client: { id, name, redirect_uri: redirectUri, client_secret: clientSecret, created_at: ts } }, 201);
});

// DELETE /api/oauth/clients/:id
oauthRoutes.delete("/clients/:id", async (c) => {
  const accountId = c.get("account").id;
  const id = c.req.param("id");

  const res = await c.env.DB.prepare(`DELETE FROM oauth_clients WHERE id = ?1 AND account_id = ?2`)
    .bind(id, accountId)
    .run();

  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// GET /api/oauth/grants
oauthRoutes.get("/grants", async (c) => {
  const accountId = c.get("account").id;
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.client_id, g.scope, g.granted_at, g.revoked_at, c.name AS client_name
       FROM oauth_grants g
       JOIN oauth_clients c ON c.id = g.client_id
      WHERE g.account_id = ?1
      ORDER BY g.granted_at DESC`,
  )
    .bind(accountId)
    .all();
  return c.json({ grants: results ?? [] });
});

// POST /api/oauth/grants/:id/revoke
oauthRoutes.post("/grants/:id/revoke", async (c) => {
  const accountId = c.get("account").id;
  const id = c.req.param("id");

  const res = await c.env.DB.prepare(
    `UPDATE oauth_grants SET revoked_at = ?3 WHERE id = ?1 AND account_id = ?2 AND revoked_at IS NULL`,
  )
    .bind(id, accountId, now())
    .run();

  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/**
 * OAuth 2.1 Authorization endpoint.
 * GET /oauth/authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256&scope=...
 * Requires an authenticated admin session (the resource owner consents).
 */
export const oauthAuthorizeRoutes = new Hono<AppEnv>();
oauthAuthorizeRoutes.use("*", requireAuth);

oauthAuthorizeRoutes.get("/authorize", async (c) => {
  const clientId = c.req.query("client_id");
  const redirectUri = c.req.query("redirect_uri");
  const codeChallenge = c.req.query("code_challenge");
  const codeChallengeMethod = c.req.query("code_challenge_method") || "S256";
  const scope = c.req.query("scope") || "read";
  const state = c.req.query("state");

  if (!clientId || !redirectUri || !codeChallenge) {
    return c.json({ error: "missing_parameters" }, 400);
  }

  if (codeChallengeMethod !== "S256") {
    return c.json({ error: "invalid_challenge_method" }, 400);
  }

  // Verify client exists and redirect_uri matches.
  const client = await c.env.DB.prepare(
    `SELECT id, redirect_uri FROM oauth_clients WHERE id = ?1`,
  )
    .bind(clientId)
    .first<{ id: string; redirect_uri: string }>();

  if (!client || client.redirect_uri !== redirectUri) {
    return c.json({ error: "invalid_client" }, 400);
  }

  // For now, auto-approve (in production, show a consent screen).
  const account = c.get("account");
  const code = randomTokenHex(32);
  const codeHash = await sha256Hex(code);
  const ts = now();

  await c.env.DB.prepare(
    `INSERT INTO oauth_codes (id, client_id, account_id, code_hash, code_challenge, scope, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(newId(), clientId, account.id, codeHash, codeChallenge, scope, ts, ts + CODE_EXPIRY_MS)
    .run();

  // Record grant.
  await c.env.DB.prepare(
    `INSERT INTO oauth_grants (id, client_id, account_id, scope, granted_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(client_id, account_id) DO UPDATE SET scope = excluded.scope, granted_at = excluded.granted_at, revoked_at = NULL`,
  )
    .bind(newId(), clientId, account.id, scope, ts)
    .run();

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);

  return c.redirect(redirectUrl.toString());
});

/**
 * OAuth 2.1 Token endpoint.
 * POST /oauth/token with grant_type=authorization_code&code=...&redirect_uri=...&client_id=...&client_secret=...&code_verifier=...
 */
export const oauthTokenRoutes = new Hono<AppEnv>();

oauthTokenRoutes.post("/token", async (c) => {
  const body = await c.req.formData().catch(() => null);
  if (!body) return c.json({ error: "invalid_request" }, 400);

  const grantType = body.get("grant_type");
  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const clientId = body.get("client_id");
  const clientSecret = body.get("client_secret");
  const codeVerifier = body.get("code_verifier");
  const refreshToken = body.get("refresh_token");

  if (grantType === "authorization_code") {
    if (!code || !redirectUri || !clientId || !clientSecret || !codeVerifier) {
      return c.json({ error: "missing_parameters" }, 400);
    }

    const codeHash = await sha256Hex(code as string);
    const codeRecord = await c.env.DB.prepare(
      `SELECT id, client_id, account_id, code_challenge, scope, expires_at
         FROM oauth_codes
        WHERE code_hash = ?1 AND client_id = ?2`,
    )
      .bind(codeHash, clientId)
      .first<{ id: string; client_id: string; account_id: string; code_challenge: string; scope: string; expires_at: number }>();

    if (!codeRecord || codeRecord.expires_at < now()) {
      return c.json({ error: "invalid_code" }, 400);
    }

    // Verify client secret.
    const client = await c.env.DB.prepare(
      `SELECT id, client_secret_hash, redirect_uri FROM oauth_clients WHERE id = ?1`,
    )
      .bind(clientId)
      .first<{ id: string; client_secret_hash: string; redirect_uri: string }>();

    if (!client || client.client_secret_hash !== await sha256Hex(clientSecret as string) || client.redirect_uri !== redirectUri) {
      return c.json({ error: "invalid_client" }, 400);
    }

    // Verify PKCE code_verifier.
    const verifierHash = await sha256Hex(codeVerifier as string);
    // Decode base64url challenge to hex.
    const base64 = codeRecord.code_challenge.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const expectedHash = Array.from(binary).map((b) => b.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    if (verifierHash !== expectedHash) {
      return c.json({ error: "invalid_code_verifier" }, 400);
    }

    // Delete used code (single-use).
    await c.env.DB.prepare(`DELETE FROM oauth_codes WHERE id = ?1`).bind(codeRecord.id).run();

    // Issue tokens.
    const accessToken = randomTokenHex(32);
    const refreshTokenValue = randomTokenHex(32);
    const ts = now();

    await c.env.DB.prepare(
      `INSERT INTO oauth_tokens (id, client_id, account_id, access_token_hash, refresh_token_hash, scope, created_at, expires_at, refresh_expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        newId(),
        clientId,
        codeRecord.account_id,
        await sha256Hex(accessToken),
        await sha256Hex(refreshTokenValue),
        codeRecord.scope,
        ts,
        ts + ACCESS_TOKEN_EXPIRY_MS,
        ts + REFRESH_TOKEN_EXPIRY_MS,
      )
      .run();

    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_EXPIRY_MS / 1000,
      refresh_token: refreshTokenValue,
      scope: codeRecord.scope,
    });
  }

  if (grantType === "refresh_token") {
    if (!refreshToken || !clientId || !clientSecret) {
      return c.json({ error: "missing_parameters" }, 400);
    }

    const refreshTokenHash = await sha256Hex(refreshToken as string);
    const tokenRecord = await c.env.DB.prepare(
      `SELECT id, client_id, account_id, scope, refresh_expires_at
         FROM oauth_tokens
        WHERE refresh_token_hash = ?1 AND client_id = ?2`,
    )
      .bind(refreshTokenHash, clientId)
      .first<{ id: string; client_id: string; account_id: string; scope: string; refresh_expires_at: number }>();

    if (!tokenRecord || tokenRecord.refresh_expires_at < now()) {
      return c.json({ error: "invalid_refresh_token" }, 400);
    }

    // Verify client secret.
    const client = await c.env.DB.prepare(
      `SELECT id, client_secret_hash FROM oauth_clients WHERE id = ?1`,
    )
      .bind(clientId)
      .first<{ id: string; client_secret_hash: string }>();

    if (!client || client.client_secret_hash !== await sha256Hex(clientSecret as string)) {
      return c.json({ error: "invalid_client" }, 400);
    }

    // Rotate refresh token (old one becomes invalid).
    const newAccessToken = randomTokenHex(32);
    const newRefreshToken = randomTokenHex(32);
    const ts = now();

    await c.env.DB.prepare(`DELETE FROM oauth_tokens WHERE id = ?1`).bind(tokenRecord.id).run();
    await c.env.DB.prepare(
      `INSERT INTO oauth_tokens (id, client_id, account_id, access_token_hash, refresh_token_hash, scope, created_at, expires_at, refresh_expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        newId(),
        clientId,
        tokenRecord.account_id,
        await sha256Hex(newAccessToken),
        await sha256Hex(newRefreshToken),
        tokenRecord.scope,
        ts,
        ts + ACCESS_TOKEN_EXPIRY_MS,
        ts + REFRESH_TOKEN_EXPIRY_MS,
      )
      .run();

    return c.json({
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_EXPIRY_MS / 1000,
      refresh_token: newRefreshToken,
      scope: tokenRecord.scope,
    });
  }

  return c.json({ error: "unsupported_grant_type" }, 400);
});

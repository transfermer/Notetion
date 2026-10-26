import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { loadSettings, requireAuth } from "./auth";
import { now } from "./util";

const ALLOWED_KEYS = new Set(["locale", "theme", "accent", "seen_version"]);
const VALUE_MAX = 4096;

export const settingsRoutes = new Hono<AppEnv>();
settingsRoutes.use("*", requireAuth);

// GET /api/settings
settingsRoutes.get("/", async (c) => {
  return c.json({ settings: await loadSettings(c.env.DB, c.get("account").id) });
});

// PUT /api/settings — whitelist keys, upsert rows.
settingsRoutes.put("/", async (c) => {
  const accountId = c.get("account").id;
  const db = c.env.DB;

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const ts = now();
  const stmts: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key) || typeof value !== "string" || value.length > VALUE_MAX) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO settings (account_id, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(accountId, key, value, ts),
    );
  }
  if (stmts.length > 0) await db.batch(stmts);
  return c.json({ settings: await loadSettings(db, accountId) });
});

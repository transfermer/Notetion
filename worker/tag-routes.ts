import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { TAG_LIST_SQL } from "./note-list";

export const tagRoutes = new Hono<AppEnv>();
tagRoutes.use("*", requireAuth);

// GET /api/tags → { tags: [{ name, count }] }
tagRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(TAG_LIST_SQL).bind(c.get("account").id).all<{ name: string; count: number }>();
  return c.json({ tags: results ?? [] });
});

import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { newId, now, randomTokenHex, sha256Hex } from "./util";
import MarkdownIt from "markdown-it";

// Safe server-side markdown renderer for public share pages (html:false → no raw HTML/XSS).
const shareMd = new MarkdownIt({ html: false, linkify: true, breaks: false });

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderSharePage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Notetion</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,-apple-system,"Segoe UI","PingFang TC","Microsoft JhengHei",sans-serif;margin:0;background:#f7f8fa;color:#1c2333}
  @media (prefers-color-scheme:dark){body{background:#0f1115;color:#e7e9ee}}
  .wrap{max-width:760px;margin:0 auto;padding:48px 24px}
  header{border-bottom:1px solid rgba(128,128,128,.3);padding-bottom:16px;margin-bottom:24px}
  h1{margin:0 0 8px;font-size:28px}
  .meta{color:#6b7280;font-size:13px}
  .content{line-height:1.75}
  .content pre{background:rgba(128,128,128,.12);padding:14px;border-radius:8px;overflow-x:auto}
  .content code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
  .content blockquote{border-left:4px solid #4f6df5;margin:1em 0;padding:.5em 1em;color:#6b7280}
  .content table{border-collapse:collapse}
  .content th,.content td{border:1px solid rgba(128,128,128,.3);padding:6px 12px}
  .content img{max-width:100%}
  .passform{max-width:360px;margin:80px auto;background:rgba(128,128,128,.08);padding:32px;border-radius:12px}
  .passform input{width:100%;padding:10px;border:1px solid rgba(128,128,128,.4);border-radius:6px;background:transparent;color:inherit;font-size:15px;margin:12px 0}
  .passform button{width:100%;padding:10px;border:none;border-radius:6px;background:#4f6df5;color:#fff;font-size:15px;cursor:pointer}
  .err{color:#d64545;font-size:13px;margin-top:8px}
</style>
</head>
<body>
<div class="wrap">
${bodyHtml}
</div>
</body>
</html>`;
}

function wantsHtml(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const accept = c.req.header("Accept") ?? "";
  return accept.includes("text/html");
}

export const sharesRoutes = new Hono<AppEnv>();
sharesRoutes.use("*", requireAuth);

const SLUG_LENGTH = 12; // 96 bits of entropy

// GET /api/shares
sharesRoutes.get("/", async (c) => {
  const accountId = c.get("account").id;
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.note_id, s.slug, s.passphrase_hash IS NOT NULL AS has_passphrase,
            s.expires_at, s.view_count, s.created_at, n.title AS note_title
       FROM shares s
       JOIN notes n ON n.id = s.note_id
      WHERE s.account_id = ?1
      ORDER BY s.created_at DESC`,
  )
    .bind(accountId)
    .all();
  return c.json({ shares: results ?? [] });
});

// POST /api/shares
sharesRoutes.post("/", async (c) => {
  const accountId = c.get("account").id;
  const body = (await c.req.json().catch(() => null)) as { note_id?: unknown; passphrase?: unknown; expires_in_days?: unknown } | null;

  const noteId = typeof body?.note_id === "string" ? body.note_id : null;
  if (!noteId) return c.json({ error: "note_id_required" }, 400);

  // Verify note exists and belongs to account.
  const note = await c.env.DB.prepare(`SELECT id, title FROM notes WHERE id = ?1 AND account_id = ?2`)
    .bind(noteId, accountId)
    .first<{ id: string; title: string }>();
  if (!note) return c.json({ error: "note_not_found" }, 404);

  const passphrase = typeof body?.passphrase === "string" && body.passphrase.trim() ? body.passphrase.trim() : null;
  const rawDays = body?.expires_in_days;
  if (rawDays !== undefined && rawDays !== null && (typeof rawDays !== "number" || !Number.isInteger(rawDays) || rawDays < 1 || rawDays > 3650)) {
    return c.json({ error: "invalid_expires_in_days" }, 400);
  }
  const expiresInDays = typeof rawDays === "number" ? rawDays : null;

  const slug = randomTokenHex(SLUG_LENGTH);
  const passphraseHash = passphrase ? await sha256Hex(passphrase) : null;
  const ts = now();
  const expiresAt = expiresInDays ? ts + expiresInDays * 24 * 60 * 60 * 1000 : null;
  const id = newId();

  await c.env.DB.prepare(
    `INSERT INTO shares (id, account_id, note_id, slug, passphrase_hash, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(account_id, note_id) DO UPDATE SET
       slug = excluded.slug, passphrase_hash = excluded.passphrase_hash,
       expires_at = excluded.expires_at, view_count = 0`,
  )
    .bind(id, accountId, noteId, slug, passphraseHash, expiresAt, ts)
    .run();

  // On re-share the existing row (and its id) is kept; read it back so the response matches the DB.
  const row = await c.env.DB.prepare(`SELECT id, created_at FROM shares WHERE account_id = ?1 AND note_id = ?2`)
    .bind(accountId, noteId)
    .first<{ id: string; created_at: number }>();

  return c.json({ share: { id: row?.id ?? id, note_id: noteId, slug, has_passphrase: !!passphrase, expires_at: expiresAt, created_at: row?.created_at ?? ts } }, 201);
});

// DELETE /api/shares/:id
sharesRoutes.delete("/:id", async (c) => {
  const accountId = c.get("account").id;
  const id = c.req.param("id");

  const res = await c.env.DB.prepare(`DELETE FROM shares WHERE id = ?1 AND account_id = ?2`)
    .bind(id, accountId)
    .run();

  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/**
 * Public share access (no auth required).
 * GET /s/:slug
 * POST /s/:slug/verify (with passphrase)
 */
export const publicShareRoutes = new Hono<AppEnv>();

publicShareRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const share = await c.env.DB.prepare(
    `SELECT s.id, s.note_id, s.passphrase_hash, s.expires_at, s.view_count,
            n.title, n.content, n.created_at, n.updated_at, n.deleted_at
       FROM shares s
       JOIN notes n ON n.id = s.note_id
      WHERE s.slug = ?1`,
  )
    .bind(slug)
    .first<{ id: string; note_id: string; passphrase_hash: string | null; expires_at: number | null; view_count: number; title: string; content: string; created_at: number; updated_at: number; deleted_at: number | null }>();

  if (!share) return c.json({ error: "not_found" }, 404);
  if (share.expires_at && share.expires_at < now()) return c.json({ error: "expired" }, 410);
  // Do not expose trashed notes publicly.
  if (share.deleted_at !== null) return c.json({ error: "not_found" }, 404);

  if (share.passphrase_hash) {
    if (wantsHtml(c)) {
      const form = `<form class="passform" method="POST" action="/s/${escapeHtml(slug)}/verify">
        <h1>🔒 受保護的筆記</h1>
        <p class="meta">This note is passphrase-protected.</p>
        <input type="password" name="passphrase" placeholder="Passphrase" autofocus required>
        <button type="submit">Unlock</button>
      </form>`;
      return c.html(renderSharePage("Protected", form));
    }
    return c.json({ error: "passphrase_required", share_id: share.id }, 401);
  }

  // Increment view count.
  c.env.DB.prepare(`UPDATE shares SET view_count = view_count + 1 WHERE id = ?1`)
    .bind(share.id)
    .run()
    .catch(() => {});

  if (wantsHtml(c)) {
    const bodyHtml = `<header><h1>${escapeHtml(share.title || "(untitled)")}</h1><div class="meta">Shared via Notetion · updated ${new Date(share.updated_at).toISOString().slice(0, 10)}</div></header><div class="content">${shareMd.render(share.content)}</div>`;
    return c.html(renderSharePage(share.title, bodyHtml));
  }

  return c.json({
    title: share.title,
    content: share.content,
    created_at: share.created_at,
    updated_at: share.updated_at,
  });
});

publicShareRoutes.post("/:slug/verify", async (c) => {
  const slug = c.req.param("slug");
  // Accept form-encoded (from the HTML form) or JSON.
  let passphrase: string | null = null;
  const contentType = c.req.header("Content-Type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await c.req.parseBody();
    passphrase = typeof form.passphrase === "string" ? form.passphrase : null;
  } else {
    const body = (await c.req.json().catch(() => null)) as { passphrase?: unknown } | null;
    passphrase = typeof body?.passphrase === "string" ? body.passphrase : null;
  }

  if (!passphrase) return c.json({ error: "passphrase_required" }, 400);

  const share = await c.env.DB.prepare(
    `SELECT s.id, s.note_id, s.passphrase_hash, s.expires_at,
            n.title, n.content, n.created_at, n.updated_at, n.deleted_at
       FROM shares s
       JOIN notes n ON n.id = s.note_id
      WHERE s.slug = ?1`,
  )
    .bind(slug)
    .first<{ id: string; note_id: string; passphrase_hash: string; expires_at: number | null; title: string; content: string; created_at: number; updated_at: number; deleted_at: number | null }>();

  if (!share) return c.json({ error: "not_found" }, 404);
  if (share.expires_at && share.expires_at < now()) return c.json({ error: "expired" }, 410);
  if (share.deleted_at !== null) return c.json({ error: "not_found" }, 404);

  const providedHash = await sha256Hex(passphrase);
  if (providedHash !== share.passphrase_hash) {
    if (wantsHtml(c)) {
      const form = `<form class="passform" method="POST" action="/s/${escapeHtml(slug)}/verify">
        <h1>🔒 受保護的筆記</h1>
        <div class="err">Wrong passphrase. Try again.</div>
        <input type="password" name="passphrase" placeholder="Passphrase" autofocus required>
        <button type="submit">Unlock</button>
      </form>`;
      return c.html(renderSharePage("Protected", form), 401);
    }
    return c.json({ error: "invalid_passphrase" }, 401);
  }

  // Increment view count.
  c.env.DB.prepare(`UPDATE shares SET view_count = view_count + 1 WHERE id = ?1`)
    .bind(share.id)
    .run()
    .catch(() => {});

  if (wantsHtml(c)) {
    const bodyHtml = `<header><h1>${escapeHtml(share.title || "(untitled)")}</h1><div class="meta">Shared via Notetion · updated ${new Date(share.updated_at).toISOString().slice(0, 10)}</div></header><div class="content">${shareMd.render(share.content)}</div>`;
    return c.html(renderSharePage(share.title, bodyHtml));
  }

  return c.json({
    title: share.title,
    content: share.content,
    created_at: share.created_at,
    updated_at: share.updated_at,
  });
});

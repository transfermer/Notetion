import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { newId, now } from "./util";
import { WebDAVClient } from "./webdav";
import { S3Client } from "./s3";

export const backupRoutes = new Hono<AppEnv>();
backupRoutes.use("*", requireAuth);

const CHUNK_SIZE = 100 * 1024; // 100KB per chunk

// GET /api/backups/configs
backupRoutes.get("/configs", async (c) => {
  const accountId = c.get("account").id;
  const { results } = await c.env.DB.prepare(
    `SELECT id, type, name, enabled, schedule, created_at, updated_at
       FROM backup_configs
      WHERE account_id = ?1
      ORDER BY created_at DESC`,
  )
    .bind(accountId)
    .all();
  return c.json({ configs: results ?? [] });
});

// POST /api/backups/configs
backupRoutes.post("/configs", async (c) => {
  const accountId = c.get("account").id;
  const body = (await c.req.json().catch(() => null)) as {
    type?: unknown;
    name?: unknown;
    config?: unknown;
    schedule?: unknown;
  } | null;

  const type = typeof body?.type === "string" && ["webdav", "s3"].includes(body.type) ? body.type : null;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : null;
  const config = body?.config;
  const schedule = typeof body?.schedule === "string" ? body.schedule : null;

  if (!type || !name || !config) {
    return c.json({ error: "type_name_config_required" }, 400);
  }

  // Store encrypted config in CredentialVault.
  const vaultId = newId();
  const configJson = JSON.stringify(config);

  // Get vault stub.
  const vault = c.env.CREDENTIAL_VAULT;
  const vaultId_obj = vault.idFromName(accountId);
  const vaultStub = vault.get(vaultId_obj);

  // Store encrypted credentials.
  await vaultStub.fetch(new Request(`https://vault/store`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: vaultId,
      account_id: accountId,
      data: configJson,
    }),
  }));

  const ts = now();
  const id = newId();

  await c.env.DB.prepare(
    `INSERT INTO backup_configs (id, account_id, type, name, enabled, schedule, encryption_key_hash, config_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?8)`,
  )
    .bind(id, accountId, type, name, schedule, vaultId, configJson, ts)
    .run();

  return c.json({ config: { id, type, name, enabled: 1, schedule, created_at: ts, updated_at: ts } }, 201);
});

// DELETE /api/backups/configs/:id
backupRoutes.delete("/configs/:id", async (c) => {
  const accountId = c.get("account").id;
  const id = c.req.param("id");

  const res = await c.env.DB.prepare(`DELETE FROM backup_configs WHERE id = ?1 AND account_id = ?2`)
    .bind(id, accountId)
    .run();

  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// POST /api/backups/run — trigger a backup
backupRoutes.post("/run", async (c) => {
  const accountId = c.get("account").id;
  const body = (await c.req.json().catch(() => null)) as { config_id?: unknown } | null;
  const configId = typeof body?.config_id === "string" ? body.config_id : null;

  if (!configId) return c.json({ error: "config_id_required" }, 400);

  // Get config.
  const config = await c.env.DB.prepare(
    `SELECT id, type, name, config_json FROM backup_configs WHERE id = ?1 AND account_id = ?2 AND enabled = 1`,
  )
    .bind(configId, accountId)
    .first<{ id: string; type: string; name: string; config_json: string }>();

  if (!config) return c.json({ error: "config_not_found" }, 404);

  // Create backup history record.
  const backupId = newId();
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO backup_history (id, account_id, config_id, status, started_at, created_at)
     VALUES (?1, ?2, ?3, 'running', ?4, ?4)`,
  )
    .bind(backupId, accountId, configId, ts)
    .run();

  // Fetch all notes.
  const { results: notes } = await c.env.DB.prepare(
    `SELECT id, title, content, folder_id, favorite, pinned, archived, created_at, updated_at
       FROM notes
      WHERE account_id = ?1 AND deleted_at IS NULL`,
  )
    .bind(accountId)
    .all();

  // Fetch all folders.
  const { results: folders } = await c.env.DB.prepare(
    `SELECT id, parent_id, name, sort_order, created_at, updated_at
       FROM folders
      WHERE account_id = ?1`,
  )
    .bind(accountId)
    .all();

  // Create backup payload.
  const backupData = {
    version: "1.0",
    backup_id: backupId,
    account_id: accountId,
    created_at: ts,
    notes: notes ?? [],
    folders: folders ?? [],
  };

  const payload = JSON.stringify(backupData);
  const payloadBytes = new TextEncoder().encode(payload);

  try {
    const configObj = JSON.parse(config.config_json);

    if (config.type === "webdav") {
      const client = new WebDAVClient(configObj);
      const filename = `notetion-backup-${backupId}.json`;

      // Upload in chunks.
      let offset = 0;
      let chunkIndex = 0;
      while (offset < payloadBytes.length) {
        const chunk = payloadBytes.slice(offset, offset + CHUNK_SIZE);
        const chunkFilename = `${filename}.part${chunkIndex.toString().padStart(3, "0")}`;
        await client.put(chunkFilename, chunk.buffer);
        offset += CHUNK_SIZE;
        chunkIndex++;
      }
    } else if (config.type === "s3") {
      const client = new S3Client(configObj);
      const key = `backups/notetion-backup-${backupId}.json`;

      // Upload in chunks.
      let offset = 0;
      let chunkIndex = 0;
      while (offset < payloadBytes.length) {
        const chunk = payloadBytes.slice(offset, offset + CHUNK_SIZE);
        const chunkKey = `${key}.part${chunkIndex.toString().padStart(3, "0")}`;
        await client.put(chunkKey, chunk.buffer);
        offset += CHUNK_SIZE;
        chunkIndex++;
      }
    }

    // Update backup history.
    await c.env.DB.prepare(
      `UPDATE backup_history SET status = 'completed', completed_at = ?2, bytes_uploaded = ?3, notes_backed_up = ?4
        WHERE id = ?1`,
    )
      .bind(backupId, now(), payloadBytes.length, notes?.length ?? 0)
      .run();

    return c.json({ ok: true, backup_id: backupId, bytes: payloadBytes.length });
  } catch (err) {
    // Update backup history with error.
    await c.env.DB.prepare(
      `UPDATE backup_history SET status = 'failed', completed_at = ?2, error = ?3
        WHERE id = ?1`,
    )
      .bind(backupId, now(), err instanceof Error ? err.message : String(err))
      .run();

    return c.json({ error: "backup_failed", detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/backups/history
backupRoutes.get("/history", async (c) => {
  const accountId = c.get("account").id;
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.config_id, h.status, h.started_at, h.completed_at,
            h.bytes_uploaded, h.notes_backed_up, h.files_backed_up, h.error, h.created_at,
            c.name AS config_name
       FROM backup_history h
       JOIN backup_configs c ON c.id = h.config_id
      WHERE h.account_id = ?1
      ORDER BY h.created_at DESC
      LIMIT 50`,
  )
    .bind(accountId)
    .all();
  return c.json({ history: results ?? [] });
});

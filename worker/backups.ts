import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { requireAuth } from "./auth";
import { newId, now } from "./util";
import { WebDAVClient } from "./webdav";
import { S3Client } from "./s3";
import { gzipText } from "./gzip";
import { isSealed, openJson, sealJson, SecretNotConfiguredError } from "./crypto-box";
import {
  parseSchedule,
  validateBackupConfig,
  type BackupType,
  type S3Config,
  type Schedule,
  type WebDavConfig,
} from "./backup-config";

/** `BACKUP_ENCRYPTION_KEY` is a Worker secret (wrangler secret put), so it is not in the generated Env type. */
type BackupEnv = Env & { BACKUP_ENCRYPTION_KEY?: string };

export const backupRoutes = new Hono<AppEnv>();
backupRoutes.use("*", requireAuth);

const BUSY_WINDOW_MS = 10 * 60 * 1000;

interface ConfigRow {
  id: string;
  type: string;
  name: string;
  config_json: string;
}

const aad = (accountId: string, configId: string) => `${accountId}:${configId}`;

/**
 * Decrypt a stored config. Rows written by older versions hold PLAINTEXT JSON
 * (`{...}`); those are accepted once and immediately re-sealed in place.
 */
async function loadConfig(env: BackupEnv, accountId: string, row: ConfigRow): Promise<WebDavConfig | S3Config> {
  if (isSealed(row.config_json)) {
    return openJson<WebDavConfig | S3Config>(env.BACKUP_ENCRYPTION_KEY, aad(accountId, row.id), row.config_json);
  }
  const legacy = JSON.parse(row.config_json) as unknown;
  const checked = validateBackupConfig(row.type as BackupType, legacy);
  if (!checked.ok) throw new Error(`stored config invalid: ${checked.error}`);
  const sealed = await sealJson(env.BACKUP_ENCRYPTION_KEY, aad(accountId, row.id), checked.config);
  await env.DB.prepare(`UPDATE backup_configs SET config_json = ?3, encryption_key_hash = 'v1', updated_at = ?4 WHERE id = ?1 AND account_id = ?2`)
    .bind(row.id, accountId, sealed, now())
    .run();
  return checked.config;
}

function safeMessage(err: unknown): string {
  if (err instanceof SecretNotConfiguredError) return "BACKUP_ENCRYPTION_KEY is not configured";
  if (err instanceof DOMException && err.name === "OperationError") return "cannot decrypt stored credentials (was BACKUP_ENCRYPTION_KEY changed?)";
  const m = err instanceof Error ? err.message : String(err);
  return m.slice(0, 300);
}

async function buildPayload(env: Env, accountId: string, backupId: string, ts: number) {
  const [notes, folders, tags] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, title, content, folder_id, favorite, pinned, archived, created_at, updated_at
         FROM notes WHERE account_id = ?1 AND deleted_at IS NULL`,
    ).bind(accountId),
    env.DB.prepare(
      `SELECT id, parent_id, name, sort_order, created_at, updated_at FROM folders WHERE account_id = ?1`,
    ).bind(accountId),
    env.DB.prepare(
      `SELECT nt.note_id, t.name AS tag
         FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
         JOIN notes n ON n.id = nt.note_id
        WHERE t.account_id = ?1 AND n.deleted_at IS NULL`,
    ).bind(accountId),
  ]);
  const payload = {
    version: "1.1",
    backup_id: backupId,
    account_id: accountId,
    created_at: ts,
    notes: notes.results ?? [],
    folders: folders.results ?? [],
    note_tags: tags.results ?? [],
  };
  return { payload, noteCount: payload.notes.length };
}

export type BackupResult =
  | { ok: true; backupId: string; bytes: number; notes: number }
  | { ok: false; status: number; error: string; detail?: string };

/** One backup run for one config; shared by the manual endpoint and the cron job. */
export async function executeBackup(env: BackupEnv, accountId: string, row: ConfigRow): Promise<BackupResult> {
  const recent = await env.DB.prepare(
    `SELECT 1 AS x FROM backup_history WHERE config_id = ?1 AND status = 'running' AND started_at > ?2 LIMIT 1`,
  )
    .bind(row.id, now() - BUSY_WINDOW_MS)
    .first();
  if (recent) return { ok: false, status: 409, error: "backup_already_running" };

  const backupId = newId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO backup_history (id, account_id, config_id, status, started_at, created_at) VALUES (?1, ?2, ?3, 'running', ?4, ?4)`,
  )
    .bind(backupId, accountId, row.id, ts)
    .run();

  try {
    const config = await loadConfig(env, accountId, row);
    const { payload, noteCount } = await buildPayload(env, accountId, backupId, ts);
    const gz = await gzipText(JSON.stringify(payload));
    const stamp = new Date(ts).toISOString().slice(0, 10);
    const filename = `notetion-backup-${stamp}-${backupId.slice(0, 8)}.json.gz`;

    if (row.type === "webdav") {
      await new WebDAVClient(config as WebDavConfig).put(filename, gz, "application/gzip");
    } else {
      await new S3Client(config as S3Config).put(`backups/${filename}`, gz, "application/gzip");
    }

    await env.DB.prepare(
      `UPDATE backup_history SET status = 'completed', completed_at = ?2, bytes_uploaded = ?3, notes_backed_up = ?4 WHERE id = ?1`,
    )
      .bind(backupId, now(), gz.length, noteCount)
      .run();
    return { ok: true, backupId, bytes: gz.length, notes: noteCount };
  } catch (err) {
    const detail = safeMessage(err);
    await env.DB.prepare(`UPDATE backup_history SET status = 'failed', completed_at = ?2, error = ?3 WHERE id = ?1`)
      .bind(backupId, now(), detail)
      .run();
    console.error("backup_failed", JSON.stringify({ config: row.id, detail }));
    return { ok: false, status: err instanceof SecretNotConfiguredError ? 503 : 502, error: "backup_failed", detail };
  }
}

/** Cron entry point: run every enabled config whose schedule matches the trigger that fired. */
export async function runScheduledBackups(env: BackupEnv, schedules: Schedule[]): Promise<void> {
  if (!schedules.length) return;
  const marks = schedules.map((_, i) => `?${i + 1}`).join(",");
  const { results } = await env.DB.prepare(
    `SELECT id, account_id, type, name, config_json FROM backup_configs WHERE enabled = 1 AND schedule IN (${marks})`,
  )
    .bind(...schedules)
    .all<ConfigRow & { account_id: string }>();
  // Sequential on purpose: each run is a handful of subrequests; keeps us under the plan's limit per invocation.
  for (const row of results ?? []) {
    await executeBackup(env, row.account_id, row);
  }
}

// GET /api/backups/configs  (never returns credentials)
backupRoutes.get("/configs", async (c) => {
  const accountId = c.get("account").id;
  const { results } = await c.env.DB.prepare(
    `SELECT id, type, name, enabled, schedule, created_at, updated_at
       FROM backup_configs WHERE account_id = ?1 ORDER BY created_at DESC`,
  )
    .bind(accountId)
    .all();
  return c.json({ configs: results ?? [] });
});

// POST /api/backups/configs
backupRoutes.post("/configs", async (c) => {
  const env = c.env as BackupEnv;
  const accountId = c.get("account").id;
  const body = (await c.req.json().catch(() => null)) as {
    type?: unknown; name?: unknown; config?: unknown; schedule?: unknown;
  } | null;

  const type = body?.type === "webdav" || body?.type === "s3" ? (body.type as BackupType) : null;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : null;
  if (!type || !name) return c.json({ error: "type_name_config_required" }, 400);

  const checked = validateBackupConfig(type, body?.config);
  if (!checked.ok) return c.json({ error: checked.error }, 400);
  const sched = parseSchedule(body?.schedule);
  if (!sched.ok) return c.json({ error: "invalid_schedule" }, 400);

  if (!env.BACKUP_ENCRYPTION_KEY || env.BACKUP_ENCRYPTION_KEY.length < 32) {
    // Refuse rather than store credentials unencrypted.
    return c.json({ error: "server_misconfigured", detail: "BACKUP_ENCRYPTION_KEY secret is not set" }, 503);
  }

  const id = newId();
  const ts = now();
  const sealed = await sealJson(env.BACKUP_ENCRYPTION_KEY, aad(accountId, id), checked.config);
  try {
    await env.DB.prepare(
      `INSERT INTO backup_configs (id, account_id, type, name, enabled, schedule, encryption_key_hash, config_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, 'v1', ?6, ?7, ?7)`,
    )
      .bind(id, accountId, type, name, sched.value, sealed, ts)
      .run();
  } catch (err) {
    if (String(err).includes("UNIQUE")) return c.json({ error: "name_taken" }, 409);
    throw err;
  }
  return c.json({ config: { id, type, name, enabled: 1, schedule: sched.value, created_at: ts, updated_at: ts } }, 201);
});

// DELETE /api/backups/configs/:id
backupRoutes.delete("/configs/:id", async (c) => {
  const accountId = c.get("account").id;
  const res = await c.env.DB.prepare(`DELETE FROM backup_configs WHERE id = ?1 AND account_id = ?2`)
    .bind(c.req.param("id"), accountId)
    .run();
  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// POST /api/backups/run
backupRoutes.post("/run", async (c) => {
  const accountId = c.get("account").id;
  const body = (await c.req.json().catch(() => null)) as { config_id?: unknown } | null;
  const configId = typeof body?.config_id === "string" ? body.config_id : null;
  if (!configId) return c.json({ error: "config_id_required" }, 400);

  const row = await c.env.DB.prepare(
    `SELECT id, type, name, config_json FROM backup_configs WHERE id = ?1 AND account_id = ?2 AND enabled = 1`,
  )
    .bind(configId, accountId)
    .first<ConfigRow>();
  if (!row) return c.json({ error: "config_not_found" }, 404);

  const r = await executeBackup(c.env as BackupEnv, accountId, row);
  if (r.ok) return c.json({ ok: true, backup_id: r.backupId, bytes: r.bytes, notes: r.notes });
  return c.json({ error: r.error, detail: r.detail }, r.status as 409 | 502 | 503);
});

// GET /api/backups/history
backupRoutes.get("/history", async (c) => {
  const accountId = c.get("account").id;
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.config_id, h.status, h.started_at, h.completed_at,
            h.bytes_uploaded, h.notes_backed_up, h.files_backed_up, h.error, h.created_at,
            c.name AS config_name
       FROM backup_history h JOIN backup_configs c ON c.id = h.config_id
      WHERE h.account_id = ?1 ORDER BY h.created_at DESC LIMIT 50`,
  )
    .bind(accountId)
    .all();
  return c.json({ history: results ?? [] });
});

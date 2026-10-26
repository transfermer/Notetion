import { now } from "./util";

/**
 * Daily housekeeping (cron trigger `17 3 * * *` in wrangler.jsonc):
 *  - drop expired sessions
 *  - mark backup runs stuck in 'running' for over an hour as failed
 *  - hard-delete trashed notes past their 30-day purge deadline
 *  - purge version snapshots beyond retention limit (default 50 per note)
 */
export async function runCleanup(env: Env): Promise<void> {
  const ts = now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?1`).bind(ts),
    // A run that died mid-flight (Worker evicted) would otherwise show "running" forever and block retries.
    env.DB.prepare(`UPDATE backup_history SET status = 'failed', completed_at = ?1, error = 'interrupted' WHERE status = 'running' AND started_at < ?2`).bind(ts, ts - 60 * 60 * 1000),
    env.DB.prepare(`DELETE FROM login_attempts WHERE attempted_at < ?1`).bind(ts - 24 * 60 * 60 * 1000),
    env.DB.prepare(`DELETE FROM notes WHERE purge_at IS NOT NULL AND purge_at < ?1`).bind(ts),
    // Keep only the N most-recent snapshots per note (N = retention.max_versions, default 50).
    // Uses ROW_NUMBER() rank (distance from newest), NOT the raw version number.
    env.DB.prepare(`
      DELETE FROM note_versions
       WHERE id IN (
         SELECT id FROM (
           SELECT nv.id,
                  ROW_NUMBER() OVER (PARTITION BY nv.note_id ORDER BY nv.version DESC) AS rn,
                  COALESCE((SELECT r.max_versions FROM note_version_retention r WHERE r.note_id = nv.note_id), 50) AS maxv
             FROM note_versions nv
         )
         WHERE rn > maxv
       )
    `),
  ]);
}

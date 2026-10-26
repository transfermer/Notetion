/** Per-IP login throttling backed by D1 (pure logic; unit-tested against the real migration). */

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 8;

export interface RLDb {
  prepare(q: string): {
    bind(...v: unknown[]): {
      run(): Promise<unknown>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

/** Seconds the caller must wait, or 0 if the attempt is allowed. */
export async function loginRetryAfter(db: RLDb, ip: string, ts: number): Promise<number> {
  const since = ts - LOGIN_WINDOW_MS;
  const row = await db
    .prepare(`SELECT COUNT(*) AS n, MIN(attempted_at) AS first_at FROM login_attempts WHERE ip = ?1 AND attempted_at > ?2`)
    .bind(ip, since)
    .first<{ n: number; first_at: number | null }>();
  if (!row || row.n < LOGIN_MAX_FAILURES || row.first_at == null) return 0;
  return Math.max(1, Math.ceil((row.first_at + LOGIN_WINDOW_MS - ts) / 1000));
}

export async function recordLoginFailure(db: RLDb, ip: string, ts: number): Promise<void> {
  await db.prepare(`INSERT INTO login_attempts (ip, attempted_at) VALUES (?1, ?2)`).bind(ip, ts).run();
}

export async function clearLoginFailures(db: RLDb, ip: string): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE ip = ?1`).bind(ip).run();
}

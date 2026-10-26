/** Validation + scheduling rules for backup configs (pure, unit-tested). */

export type BackupType = "webdav" | "s3";

/**
 * Schedules are a fixed set that map 1:1 onto the cron triggers declared in
 * wrangler.jsonc. (Free-form cron strings were stored before, but only an exact
 * string match against the firing trigger ever ran, so almost nothing did.)
 */
export const SCHEDULES = ["daily", "6h"] as const;
export type Schedule = (typeof SCHEDULES)[number];

/** MUST match `triggers.crons` in wrangler.jsonc (a test enforces this). */
export const CRON_DAILY = "17 3 * * *";
export const CRON_EVERY_6H = "0 */6 * * *";

export function cronToSchedules(cron: string): Schedule[] {
  if (cron === CRON_DAILY) return ["daily"];
  if (cron === CRON_EVERY_6H) return ["6h"];
  return [];
}

export function parseSchedule(input: unknown): { ok: true; value: Schedule | null } | { ok: false } {
  if (input === undefined || input === null || input === "") return { ok: true, value: null };
  if (typeof input === "string" && (SCHEDULES as readonly string[]).includes(input)) {
    return { ok: true, value: input as Schedule };
  }
  return { ok: false };
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  );
}

/** https only; no localhost / private / link-local / IPv6-literal hosts. Returns the normalised URL or null. */
export function safeHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (host.startsWith("[") || host.includes(":")) return null; // IPv6 literal
  if (isPrivateIPv4(host)) return null;
  return u.toString();
}

export interface WebDavConfig { url: string; username: string; password: string }
export interface S3Config { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }

const str = (v: unknown, max = 512): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

export function validateBackupConfig(
  type: BackupType,
  raw: unknown,
): { ok: true; config: WebDavConfig | S3Config } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "config_required" };
  const c = raw as Record<string, unknown>;

  if (type === "webdav") {
    const url = safeHttpsUrl(c.url);
    const username = str(c.username, 256);
    const password = str(c.password, 1024);
    if (!url) return { ok: false, error: "invalid_url" };
    if (!username || !password) return { ok: false, error: "credentials_required" };
    return { ok: true, config: { url, username, password } };
  }

  const endpoint = safeHttpsUrl(c.endpoint);
  const region = str(c.region, 64) ?? "auto";
  const bucket = str(c.bucket, 128);
  const accessKeyId = str(c.accessKeyId, 256);
  const secretAccessKey = str(c.secretAccessKey, 1024);
  if (!endpoint) return { ok: false, error: "invalid_url" };
  if (!bucket || !/^[A-Za-z0-9._-]+$/.test(bucket)) return { ok: false, error: "invalid_bucket" };
  if (!accessKeyId || !secretAccessKey) return { ok: false, error: "credentials_required" };
  return { ok: true, config: { endpoint: endpoint.replace(/\/+$/, ""), region, bucket, accessKeyId, secretAccessKey } };
}

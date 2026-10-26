import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sealJson, openJson, isSealed, SecretNotConfiguredError } from "../worker/crypto-box.ts";
import { validateBackupConfig, safeHttpsUrl, parseSchedule, cronToSchedules, CRON_DAILY, CRON_EVERY_6H } from "../worker/backup-config.ts";
import { gzipText } from "../worker/gzip.ts";
import { gunzipSync } from "node:zlib";

const SECRET = "x".repeat(48);
const cfg = { url: "https://dav.example.com/backups/", username: "alice", password: "p@ss wörd 密碼" };

test("round trip, incl. non-ASCII", async () => {
  const sealed = await sealJson(SECRET, "acct:cfg1", cfg);
  assert.ok(isSealed(sealed));
  assert.deepEqual(await openJson(SECRET, "acct:cfg1", sealed), cfg);
});

test("ciphertext does not contain the plaintext secrets", async () => {
  const sealed = await sealJson(SECRET, "a:b", cfg);
  const decodedBlob = Buffer.from(sealed.split(".")[2], "base64").toString("latin1");
  for (const needle of ["alice", "p@ss", "dav.example.com"]) {
    assert.ok(!sealed.includes(needle) && !decodedBlob.includes(needle), needle);
  }
});

test("same input encrypts differently each time (random IV)", async () => {
  assert.notEqual(await sealJson(SECRET, "a:b", cfg), await sealJson(SECRET, "a:b", cfg));
});

test("wrong key, wrong row (aad) and tampering are all rejected", async () => {
  const sealed = await sealJson(SECRET, "acct:cfg1", cfg);
  await assert.rejects(() => openJson("y".repeat(48), "acct:cfg1", sealed), "wrong key");
  await assert.rejects(() => openJson(SECRET, "acct:OTHER", sealed), "blob moved to another row");
  const [v, iv, ct] = sealed.split(".");
  const flipped = Buffer.from(ct, "base64");
  flipped[0] ^= 1;
  await assert.rejects(() => openJson(SECRET, "acct:cfg1", `${v}.${iv}.${flipped.toString("base64")}`), "tampered");
  await assert.rejects(() => openJson(SECRET, "acct:cfg1", "plain text"), "not sealed");
});

test("missing or short secret refuses to encrypt (never falls back to plaintext)", async () => {
  await assert.rejects(() => sealJson(undefined, "a", cfg), SecretNotConfiguredError);
  await assert.rejects(() => sealJson("short", "a", cfg), SecretNotConfiguredError);
});

test("safeHttpsUrl blocks http, credentials-in-URL, localhost and private ranges", () => {
  for (const bad of ["http://dav.example.com", "https://user:pw@dav.example.com", "https://localhost/x", "https://127.0.0.1/", "https://10.0.0.5/", "https://192.168.1.2/", "https://172.20.0.1/", "https://169.254.169.254/", "https://[::1]/", "https://nas.local/", "https://svc.internal/", "ftp://x.com", "not a url", 42]) {
    assert.equal(safeHttpsUrl(bad as unknown), null, String(bad));
  }
  for (const good of ["https://dav.example.com/backups", "https://acct.r2.cloudflarestorage.com", "https://8.8.8.8/x"]) {
    assert.ok(safeHttpsUrl(good), good);
  }
});

test("validateBackupConfig", () => {
  assert.equal(validateBackupConfig("webdav", cfg).ok, true);
  assert.deepEqual(validateBackupConfig("webdav", { ...cfg, url: "http://x.com" }), { ok: false, error: "invalid_url" });
  assert.deepEqual(validateBackupConfig("webdav", { ...cfg, password: "" }), { ok: false, error: "credentials_required" });
  const s3 = { endpoint: "https://acct.r2.cloudflarestorage.com/", region: "", bucket: "my-bucket", accessKeyId: "k", secretAccessKey: "s" };
  const r = validateBackupConfig("s3", s3);
  assert.ok(r.ok && (r.config as { endpoint: string; region: string }).endpoint === "https://acct.r2.cloudflarestorage.com" && (r.config as { region: string }).region === "auto");
  assert.deepEqual(validateBackupConfig("s3", { ...s3, bucket: "bad/bucket" }), { ok: false, error: "invalid_bucket" });
  assert.deepEqual(validateBackupConfig("s3", null), { ok: false, error: "config_required" });
  // unknown extra fields are dropped, not stored
  const stripped = validateBackupConfig("webdav", { ...cfg, evil: "x" });
  assert.ok(stripped.ok && !("evil" in stripped.config));
});

test("schedule values map onto the cron triggers declared in wrangler.jsonc", () => {
  assert.deepEqual(parseSchedule(""), { ok: true, value: null });
  assert.deepEqual(parseSchedule("daily"), { ok: true, value: "daily" });
  assert.deepEqual(parseSchedule("6h"), { ok: true, value: "6h" });
  assert.deepEqual(parseSchedule("0 3 * * *"), { ok: false });
  assert.deepEqual(cronToSchedules(CRON_DAILY), ["daily"]);
  assert.deepEqual(cronToSchedules(CRON_EVERY_6H), ["6h"]);
  assert.deepEqual(cronToSchedules("* * * * *"), []);
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.ok(wrangler.includes(`"${CRON_DAILY}"`) && wrangler.includes(`"${CRON_EVERY_6H}"`), "constants drifted from wrangler.jsonc");
});

test("gzip output is a valid gzip of the input", async () => {
  const text = JSON.stringify({ notes: Array.from({ length: 200 }, (_, i) => ({ i, t: "筆記".repeat(20) })) });
  const gz = await gzipText(text);
  assert.ok(gz.length < text.length / 4);
  assert.equal(gunzipSync(gz).toString("utf8"), text);
});

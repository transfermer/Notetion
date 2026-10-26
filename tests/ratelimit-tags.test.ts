import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { loginRetryAfter, recordLoginFailure, clearLoginFailures, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, type RLDb } from "../worker/ratelimit.ts";
import { extractTags } from "../worker/tags-extract.ts";

function db() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0009_login_attempts.sql", import.meta.url), "utf8"));
  const d: RLDb = {
    prepare: (q: string) => ({
      bind: (...v: unknown[]) => ({
        run: async () => sql.prepare(q).run(...(v as never[])),
        first: async <T>() => (sql.prepare(q).get(...(v as never[])) as T) ?? null,
      }),
    }),
  };
  return d;
}

test("locks after N failures, per IP, and unlocks after the window", async () => {
  const d = db();
  const t0 = 1_000_000;
  for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await recordLoginFailure(d, "1.1.1.1", t0 + i);
  assert.equal(await loginRetryAfter(d, "1.1.1.1", t0 + 100), 0);
  await recordLoginFailure(d, "1.1.1.1", t0 + 50);
  const wait = await loginRetryAfter(d, "1.1.1.1", t0 + 1000);
  assert.ok(wait > 0 && wait <= LOGIN_WINDOW_MS / 1000);
  assert.equal(await loginRetryAfter(d, "2.2.2.2", t0 + 1000), 0, "other IP unaffected");
  assert.equal(await loginRetryAfter(d, "1.1.1.1", t0 + LOGIN_WINDOW_MS + 100), 0, "window expired");
});

test("success clears failures", async () => {
  const d = db();
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await recordLoginFailure(d, "9.9.9.9", 5000 + i);
  assert.ok((await loginRetryAfter(d, "9.9.9.9", 6000)) > 0);
  await clearLoginFailures(d, "9.9.9.9");
  assert.equal(await loginRetryAfter(d, "9.9.9.9", 6000), 0);
});

test("extractTags ignores URLs, wikilinks, hex colours, code, entities", () => {
  const t = extractTags([
    "real #todo and #專案/子項 and #Work",
    "see https://example.com/page#section and [[Note#Heading]] and [x](https://a.b/#frag)",
    "color #1a2b3c and issue #123 and a&#39;s",
    "`#code` ```\n#fenced\n```",
    "foo#bar",
  ].join("\n"));
  assert.deepEqual(t.sort(), ["todo", "work", "專案/子項"].sort());
});

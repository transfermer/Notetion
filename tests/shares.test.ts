import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// Runs the exact upsert SQL from worker/shares.ts against the real migrations.
const src = readFileSync(new URL("../worker/shares.ts", import.meta.url), "utf8");
const sql = src.match(/`(INSERT INTO shares[\s\S]*?)`/)![1].replace(/\?(\d)/g, "?$1");

test("re-sharing the same note replaces the slug instead of failing", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const f of ["0001_init.sql", "0007_sharing.sql"]) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  db.exec("INSERT INTO accounts(id,username,role,created_at) VALUES('a','a','admin',1)");
  db.exec("INSERT INTO notes(id,account_id,title,content,created_at,updated_at) VALUES('n','a','t','c',1,1)");
  const run = (id: string, slug: string, pass: string | null) =>
    db.prepare(sql).run(id, "a", "n", slug, pass, null, 5);
  run("s1", "slug-one", null);
  db.exec("UPDATE shares SET view_count = 9");
  run("s2", "slug-two", "hash");
  const rows = db.prepare("SELECT id, slug, passphrase_hash, view_count FROM shares").all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { id: "s1", slug: "slug-two", passphrase_hash: "hash", view_count: 0 });
});

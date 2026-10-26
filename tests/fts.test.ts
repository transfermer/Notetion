import { test, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { keywordSearch, ftsSafeQuery, escapeLike, containsCJK, type D1Like } from "../worker/fts.ts";

/** Adapt node:sqlite to the tiny slice of the D1 API that fts.ts uses; schema = the REAL migrations. */
function makeDb() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const f of ["0001_init.sql", "0003_search.sql"]) {
    sql.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  }
  const d1: D1Like = {
    prepare: (q: string) => ({
      bind: (...v: unknown[]) => ({
        all: async <T>() => ({ results: sql.prepare(q).all(...(v as never[])) as T[] }),
      }),
    }),
  };
  return { sql, d1 };
}

let sql: DatabaseSync;
let d1: D1Like;
before(() => {
  ({ sql, d1 } = makeDb());
  sql.exec("INSERT INTO accounts(id,username,role,created_at) VALUES('a','a','admin',1),('b','b','admin',1)");
  const ins = sql.prepare("INSERT INTO notes(id,account_id,title,content,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?)");
  ins.run("n1", "a", "我的筆記", "今天學習了雲端部署與資料庫設計。 hello world", 1, 10, null);
  ins.run("n2", "a", "Notes on SQLite", "FTS5 and prefix search with C++ and 100% coverage_test", 1, 20, null);
  ins.run("n3", "a", "垃圾桶", "已刪除的筆記 部署", 1, 30, 99);
  ins.run("n4", "b", "別人的", "雲端部署 secret", 1, 40, null);
  ins.run("n5", "a", "Mixed", "使用 Cloudflare Workers 部署 API", 1, 50, null);
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

test("Chinese substring queries now hit (FTS alone returned 0)", async () => {
  assert.deepEqual(ids(await keywordSearch(d1, "a", "筆記", 20)), ["n1"]);
  assert.deepEqual(ids(await keywordSearch(d1, "a", "雲端", 20)), ["n1"]);
  assert.deepEqual(ids(await keywordSearch(d1, "a", "部署", 20)), ["n1", "n5"]);
});

test("multi-token CJK query is AND", async () => {
  assert.deepEqual(ids(await keywordSearch(d1, "a", "雲端 資料庫", 20)), ["n1"]);
  assert.deepEqual(ids(await keywordSearch(d1, "a", "雲端 workers", 20)), []);
});

test("trashed notes and other accounts never leak", async () => {
  const r = await keywordSearch(d1, "a", "部署", 20);
  assert.ok(!r.some((x) => x.id === "n3" || x.id === "n4"));
});

test("English prefix search works (hel → hello)", async () => {
  assert.deepEqual(ids(await keywordSearch(d1, "a", "hel", 20)), ["n1"]);
  assert.deepEqual(ids(await keywordSearch(d1, "a", "sqli", 20)), ["n2"]);
});

test("FTS syntax characters are harmless instead of throwing", async () => {
  for (const q of ['C++', 'foo-bar', '"unbalanced', "AND OR NOT", "title:hello", "a*b(", "NEAR(", "'; DROP TABLE notes;--"]) {
    await assert.doesNotReject(() => keywordSearch(d1, "a", q, 20), q);
  }
  assert.deepEqual(ids(await keywordSearch(d1, "a", "C++", 20)), ["n2"]);
});

test("LIKE wildcards typed by the user are literal", async () => {
  // '%' / '_' in CJK-triggered LIKE path must not match everything
  assert.deepEqual(ids(await keywordSearch(d1, "a", "筆%", 20)), []);
  assert.deepEqual(ids(await keywordSearch(d1, "a", "部_", 20)), []);
  assert.equal(escapeLike("a%b_c\\d"), "a\\%b\\_c\\\\d");
});

test("FTS snippets come from the content column and carry <mark>", async () => {
  const r = await keywordSearch(d1, "a", "prefix", 20);
  assert.equal(r.length, 1);
  assert.match(r[0].snippet ?? "", /<mark>prefix<\/mark>/i);
});

test("CJK LIKE snippet is an excerpt around the match", async () => {
  const r = await keywordSearch(d1, "a", "資料庫", 20);
  assert.match(r[0].snippet ?? "", /資料庫/);
});

test("empty / whitespace query", async () => {
  assert.deepEqual(await keywordSearch(d1, "a", "   ", 20), []);
  assert.equal(ftsSafeQuery("  "), null);
});

test("limit is honoured after merging FTS + LIKE", async () => {
  assert.equal((await keywordSearch(d1, "a", "部署", 1)).length, 1);
});

test("helpers", () => {
  assert.ok(containsCJK("abc雲") && !containsCJK("abc"));
  assert.equal(ftsSafeQuery('say "hi" 筆記'), '"say"* """hi""" "筆記"');
});

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { buildNoteListQuery, normalizeTag, TAG_LIST_SQL } from "../worker/note-list.ts";
import { extractTags } from "../worker/tags-extract.ts";

let sql: DatabaseSync;
const COLS = "id, folder_id, title";
const ids = (q: Parameters<typeof buildNoteListQuery>[0]) => {
  const { sql: s, params } = buildNoteListQuery(q, COLS);
  return (sql.prepare(s).all(...(params as never[])) as Array<{ id: string }>).map((r) => r.id).sort();
};

before(() => {
  sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const f of ["0001_init.sql", "0003_search.sql"]) sql.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  sql.exec("INSERT INTO accounts(id,username,role,created_at) VALUES('a','a','admin',1),('b','b','admin',1)");
  sql.exec("INSERT INTO folders(id,account_id,name,created_at,updated_at) VALUES('f1','a','F',1,1)");
  const note = sql.prepare("INSERT INTO notes(id,account_id,folder_id,title,content,archived,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,1)");
  note.run("n1", "a", "f1", "one", "#work #idea", 0, null);
  note.run("n2", "a", null, "two", "#work", 0, null);
  note.run("n3", "a", null, "three", "#work", 0, 5); // trashed
  note.run("n4", "a", null, "four", "#work", 1, null); // archived
  note.run("n5", "b", null, "other account", "#work", 0, null);
  const tag = sql.prepare("INSERT INTO tags(id,account_id,name,created_at) VALUES(?,?,?,1)");
  const link = sql.prepare("INSERT INTO note_tags(note_id,tag_id) VALUES(?,?)");
  tag.run("tw", "a", "work"); tag.run("ti", "a", "idea"); tag.run("bw", "b", "work");
  for (const n of ["n1", "n2", "n3", "n4"]) link.run(n, "tw");
  link.run("n1", "ti");
  link.run("n5", "bw");
});

test("tag filter returns only that account's live notes with the tag", () => {
  assert.deepEqual(ids({ accountId: "a", tag: "work" }), ["n1", "n2"]);
  assert.deepEqual(ids({ accountId: "a", tag: "#IDEA " }), ["n1"]);
  assert.deepEqual(ids({ accountId: "a", tag: "nope" }), []);
  assert.deepEqual(ids({ accountId: "b", tag: "work" }), ["n5"]);
});

test("tag combines with folder; no tag keeps old behaviour", () => {
  assert.deepEqual(ids({ accountId: "a", tag: "work", folderId: "f1" }), ["n1"]);
  assert.deepEqual(ids({ accountId: "a", folderId: "f1" }), ["n1"]);
  assert.deepEqual(ids({ accountId: "a" }), ["n1", "n2"]);
  assert.deepEqual(ids({ accountId: "a", trash: true }), ["n3"]);
  assert.deepEqual(ids({ accountId: "a", archived: true }), ["n4"]);
});

test("tag list counts live notes only, scoped to the account", () => {
  const rows = (sql.prepare(TAG_LIST_SQL).all("a") as Array<{ name: string; count: number }>).map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ name: "work", count: 2 }, { name: "idea", count: 1 }]);
});

test("normalizeTag matches what extractTags stores", () => {
  assert.equal(normalizeTag("#Work"), "work");
  assert.equal(normalizeTag("  "), null);
  assert.equal(normalizeTag(null), null);
  assert.deepEqual(extractTags("#Work"), [normalizeTag("Work")]);
});

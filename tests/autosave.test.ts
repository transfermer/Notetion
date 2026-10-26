import { test } from "node:test";
import assert from "node:assert/strict";
import { AutosaveController, type SavedNote, type SavePatch } from "../src/autosave.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fake server holding one note, with version-checked PATCH (like the real API). */
function fakeServer(initial: SavedNote, opts: { latencyMs?: number; failTimes?: number } = {}) {
  const note = { ...initial };
  const calls: SavePatch[] = [];
  let failures = opts.failTimes ?? 0;
  let inflight = 0;
  let maxInflight = 0;
  const save = async (patch: SavePatch): Promise<SavedNote> => {
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    calls.push(patch);
    await sleep(opts.latencyMs ?? 1);
    inflight--;
    if (failures > 0) {
      failures--;
      throw new Error("network");
    }
    if (patch.base_version !== note.version) throw Object.assign(new Error("409"), { status: 409, note: { ...note } });
    note.title = patch.title;
    note.content = patch.content;
    note.version++;
    return { ...note };
  };
  const asConflict = (e: unknown) => ((e as { status?: number })?.status === 409 ? (e as { note: SavedNote }).note : null);
  return { note, calls, save, asConflict, get maxInflight() { return maxInflight; } };
}

const base = (v = 1): SavedNote => ({ version: v, title: "T", content: "c" });

test("debounce coalesces rapid edits into one save of the latest text", async () => {
  const s = fakeServer(base());
  const c = new AutosaveController(base(), { ...s, delayMs: 20 });
  c.update("T", "a");
  c.update("T", "ab");
  c.update("T", "abc");
  await sleep(80);
  assert.equal(s.calls.length, 1);
  assert.equal(s.note.content, "abc");
  assert.equal(c.state, "saved");
});

test("title edit followed by body edit keeps the NEW title (regression: stale title)", async () => {
  const s = fakeServer(base());
  const c = new AutosaveController(base(), { ...s, delayMs: 10 });
  c.update("New title", "c"); // user edits title
  c.update("New title", "c!"); // then types in body (caller passes the current title)
  await sleep(60);
  assert.equal(s.note.title, "New title");
  assert.equal(s.note.content, "c!");
});

test("edits made while a save is in flight never cause a self-conflict", async () => {
  const s = fakeServer(base(), { latencyMs: 40 });
  const c = new AutosaveController(base(), { ...s, delayMs: 5 });
  c.update("T", "one");
  await sleep(15); // first PATCH now in flight
  c.update("T", "two");
  await sleep(10);
  c.update("T", "three"); // timer would have fired during flight with old code
  await sleep(200);
  assert.equal(s.maxInflight, 1, "only one request at a time");
  assert.equal(s.note.content, "three");
  assert.notEqual(c.state, "conflict");
  assert.equal(s.note.version, 1 + s.calls.length);
});

test("dispose() flushes pending edits instead of dropping them", async () => {
  const s = fakeServer(base());
  const c = new AutosaveController(base(), { ...s, delayMs: 10_000 });
  c.update("T", "unsaved work");
  c.dispose(); // e.g. user switched notes / logged out / closed tab
  await sleep(30);
  assert.equal(s.note.content, "unsaved work");
});

test("two controllers never write to each other's note (regression: stale noteId)", async () => {
  const a = fakeServer({ version: 1, title: "A", content: "a" });
  const b = fakeServer({ version: 1, title: "B", content: "b" });
  const ca = new AutosaveController(a.note, { ...a, delayMs: 5 });
  const cb = new AutosaveController(b.note, { ...b, delayMs: 5 });
  cb.update("B", "b edited");
  await sleep(40);
  assert.equal(a.calls.length, 0, "A untouched");
  assert.equal(b.note.content, "b edited");
  ca.dispose();
  cb.dispose();
});

test("unchanged text (e.g. programmatic setValue) does not trigger a save", async () => {
  const s = fakeServer(base());
  const c = new AutosaveController(base(), { ...s, delayMs: 5 });
  c.update("T", "c");
  await sleep(30);
  assert.equal(s.calls.length, 0);
});

test("conflict keeps the local draft; keepMine overwrites using the server version", async () => {
  const s = fakeServer(base());
  s.note.version = 5; // someone else saved meanwhile
  s.note.content = "server text";
  const c = new AutosaveController(base(1), { ...s, delayMs: 5 });
  c.update("T", "my text");
  await sleep(30);
  assert.equal(c.state, "conflict");
  assert.equal(c.unsaved?.content, "my text", "draft preserved");
  c.update("T", "my text 2"); // typing during conflict must not hammer the server
  await sleep(30);
  assert.equal(s.calls.length, 1);
  await c.keepMine();
  assert.equal(s.note.content, "my text 2");
  assert.equal(c.state, "saved");
});

test("discardMine drops the draft", async () => {
  const s = fakeServer(base());
  s.note.version = 3;
  const c = new AutosaveController(base(1), { ...s, delayMs: 5 });
  c.update("T", "mine");
  await sleep(30);
  assert.equal(c.state, "conflict");
  c.discardMine();
  assert.equal(c.unsaved, null);
  assert.equal(c.state, "idle");
});

test("network errors retry automatically and eventually save", async () => {
  const s = fakeServer(base(), { failTimes: 2 });
  const c = new AutosaveController(base(), { ...s, delayMs: 5, retryMs: 15 });
  c.update("T", "retry me");
  await sleep(200);
  assert.equal(s.note.content, "retry me");
  assert.equal(c.state, "saved");
});

test("exclusive() (favorite/pin) pauses autosave and adopts the new version", async () => {
  const s = fakeServer(base());
  const c = new AutosaveController(base(), { ...s, delayMs: 5 });
  await c.exclusive(async () => {
    s.note.version++; // server-side flag PATCH bumps version
    return { ...s.note };
  });
  c.update("T", "after flag");
  await sleep(40);
  assert.equal(s.note.content, "after flag");
  assert.notEqual(c.state, "conflict");
});

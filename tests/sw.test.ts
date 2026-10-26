import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://notes.example.com";

/** Load the real sw.js into a sandbox with fake CacheStorage / fetch / clients. */
function boot(network: (req: Request) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const handlers: Record<string, (e: any) => void> = {};
  const fetched: string[] = [];
  const key = (r: Request | string) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);

  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        put: async (r: Request | string, res: Response) => void m.set(key(r), res),
        add: async (u: string) => void m.set(key(u), (await fetchFn(new Request(new URL(u, ORIGIN)))).clone()),
      };
    },
    async match(r: Request | string) {
      for (const m of stores.values()) if (m.has(key(r))) return m.get(key(r))!.clone();
      return undefined;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(n: string) {
      return stores.delete(n);
    },
  };
  const fetchFn = async (req: Request) => {
    fetched.push(req.url);
    return network(req);
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, h: (e: any) => void) => (handlers[t] = h),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(SRC, { self, caches, fetch: fetchFn, URL, Promise, Response, Request, console });

  async function dispatchFetch(path: string, init: { method?: string; mode?: string } = {}) {
    const request = Object.defineProperty(new Request(ORIGIN + path, { method: init.method ?? "GET" }), "mode", {
      value: init.mode ?? "cors",
    });
    let responded: Promise<Response> | null = null;
    handlers.fetch({ request, respondWith: (p: Promise<Response>) => (responded = p) });
    const res = responded ? await responded : null;
    await new Promise((r) => setTimeout(r, 5)); // let background cache.put finish
    return { intercepted: responded !== null, res };
  }
  async function lifecycle(type: "install" | "activate") {
    const ps: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => ps.push(p) });
    await Promise.all(ps);
  }
  const allCachedUrls = () => [...stores.values()].flatMap((m) => [...m.keys()]);
  return { dispatchFetch, lifecycle, stores, handlers, fetched, allCachedUrls, caches };
}

const ok = (body = "x", type = "text/html") => new Response(body, { headers: { "content-type": type } });
const asBasic = (r: Response) => Object.defineProperty(r, "type", { value: "basic" });

test("private and dynamic paths are never intercepted or cached", async () => {
  const sw = boot(async () => asBasic(ok('{"notes":[]}', "application/json")));
  await sw.lifecycle("install");
  for (const p of ["/api/notes", "/api/auth/me", "/api/files/abc", "/oauth/authorize?x=1", "/mcp/notes", "/s/slug123", "/sync/me", "/.well-known/x"]) {
    const { intercepted } = await sw.dispatchFetch(p);
    assert.equal(intercepted, false, `${p} must pass through untouched`);
  }
  assert.ok(!sw.allCachedUrls().some((u) => /\/(api|oauth|mcp|s|sync)\//.test(u)), "nothing private in CacheStorage");
});

test("non-GET requests are never intercepted", async () => {
  const sw = boot(async () => asBasic(ok()));
  for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.equal((await sw.dispatchFetch("/assets/app.js", { method: m })).intercepted, false, m);
  }
});

test("navigation is network-first: new deploys win, cache is only the offline fallback", async () => {
  let version = "v1";
  let online = true;
  const sw = boot(async () => {
    if (!online) throw new TypeError("offline");
    return asBasic(ok(`<html>${version}</html>`));
  });
  await sw.lifecycle("install");
  version = "v2"; // a deploy happened
  const a = await sw.dispatchFetch("/some/spa/route", { mode: "navigate" });
  assert.equal(await a.res!.text(), "<html>v2</html>", "must not serve the stale install-time shell while online");
  online = false;
  const b = await sw.dispatchFetch("/another/route", { mode: "navigate" });
  assert.equal(await b.res!.text(), "<html>v2</html>", "offline falls back to the last good shell");
});

test("hashed /assets/ files are cache-first", async () => {
  let hits = 0;
  const sw = boot(async () => {
    hits++;
    return asBasic(ok("console.log(1)", "text/javascript"));
  });
  await sw.dispatchFetch("/assets/index-abc123.js");
  await sw.dispatchFetch("/assets/index-abc123.js");
  assert.equal(hits, 1);
});

test("error responses and redirects are not cached", async () => {
  const sw = boot(async () => new Response("nope", { status: 500 }));
  await sw.dispatchFetch("/assets/x.js").catch(() => {});
  assert.equal(sw.allCachedUrls().filter((u) => u.endsWith("/assets/x.js")).length, 0);
});

test("activate deletes the legacy cache that held /api responses", async () => {
  const sw = boot(async () => asBasic(ok()));
  const legacy = await sw.caches.open("notetion-v1");
  await legacy.put(ORIGIN + "/api/notes", ok('{"secret":"note body"}'));
  await sw.lifecycle("install");
  await sw.lifecycle("activate");
  assert.deepEqual(await sw.caches.keys(), ["notetion-shell-v2"]);
  assert.equal(await sw.caches.match(ORIGIN + "/api/notes"), undefined);
});

test("CLEAR_CACHES message (sent on logout) wipes everything", async () => {
  const sw = boot(async () => asBasic(ok()));
  await sw.lifecycle("install");
  assert.ok((await sw.caches.keys()).length > 0);
  const ps: Promise<unknown>[] = [];
  sw.handlers.message({ data: { type: "CLEAR_CACHES" }, waitUntil: (p: Promise<unknown>) => ps.push(p) });
  await Promise.all(ps);
  assert.deepEqual(await sw.caches.keys(), []);
});

test("install tolerates a missing precache file", async () => {
  const sw = boot(async (req) => (req.url.endsWith("/manifest.json") ? new Response("", { status: 404 }) : asBasic(ok())));
  await assert.doesNotReject(() => sw.lifecycle("install"));
});

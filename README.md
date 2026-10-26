# Notetion

Private markdown notepad running entirely on the **Cloudflare Workers Free plan** —
focused writing, live preview, keyword (and optional private semantic) search, wiki-links,
offline editing, multi-device sync, private AI access (MCP), public sharing, and off-site backups.

> **Status: M9 complete** — all milestones delivered. Private markdown notepad on Cloudflare Workers Free plan with focused writing, live preview, keyword and semantic search, wiki-links, offline editing, multi-device sync, private AI access (MCP), public sharing, and off-site backups.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Vite + TypeScript + Preact (+ @preact/signals). CodeMirror 6, markdown-it, PrismJS, KaTeX, Mermaid, d3-force land in later milestones |
| Backend | Hono on Cloudflare Workers (via `@cloudflare/vite-plugin`, local `workerd`) |
| Data | D1 (accounts, notes, folders, tags, settings, versions; later FTS5 + per-account AI vectors + OAuth state), KV `FILES_KV` (attachments), Durable Objects **SQLite backend** (`SyncHub` realtime, `CredentialVault` backup keys), browser IndexedDB (offline, M3) |

**Design decision — no `OAUTH_KV`:** OAuth 2.1 state (codes/tokens/grants) will live in **D1**
(strong consistency — KV's ~60 s eventual propagation breaks the authorize→token exchange;
free-plan KV also only allows 1k writes/day; SQL makes per-account grant management trivial).

## Local development

```sh
npm install
npm run types              # generate worker-configuration.d.ts (binding types)
npm run db:migrate:local   # apply migrations/*.sql to local D1 (.wrangler/state)
cp .dev.vars.example .dev.vars   # first time only — then EDIT the password
npm run dev                # http://localhost:5173
```

Sign in with the credentials from `.dev.vars` (shipped defaults: `admin` / `notetion-local-dev`).
First successful login creates the sole admin account and seeds the two standard starter notes
(Traditional Chinese + English). Registration is closed by design.

> Note for this machine's shell: the environment exports `NPM_CONFIG_GLOBAL=true` — prefix npm
> installs with `NPM_CONFIG_GLOBAL=false` or packages go to the global prefix instead of the project.

## Scripts

| Script | Purpose |
| --- | --- |
| `dev` | Vite dev server + local `workerd` (D1/KV/DO simulated; state in `.wrangler/`) |
| `build` | Production build (client → `dist/client`, worker → `dist/notetion` + output `wrangler.json`) |
| `preview` | Run the built app in local `workerd` |
| `deploy` | Build + `wrangler deploy` (requires auth and real resource ids — see below) |
| `typecheck` | `tsc --noEmit` for `src/` and `worker/` |
| `types` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` (+ `.dev.vars` secrets) |
| `db:migrate:local` | Apply pending migrations to the local D1 |
| `db:reset:local` | Wipe `.wrangler/state` and re-migrate |

## API surface (M0)

- `GET /api/health`
- `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `GET/POST /api/notes` · `GET/PATCH/DELETE /api/notes/:id` · `POST /api/notes/:id/restore` · `DELETE /api/notes/:id?permanent=1`
- `GET/POST /api/folders` · `PATCH/DELETE /api/folders/:id`
- `GET/PUT /api/settings`

`PATCH /api/notes/:id` takes `base_version` for optimistic concurrency; a stale write returns
`409 {error:"version_conflict"}`. Content edits snapshot the previous state into `note_versions`.

## Deploy checklist (when ready)

1. `npx wrangler login` (or export `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`)
2. `npx wrangler d1 create notetion-db` → replace `database_id` in `wrangler.jsonc`
3. `npx wrangler kv namespace create FILES_KV` → replace `id` in `wrangler.jsonc`
4. `npx wrangler d1 migrations apply notetion-db --remote`
5. `npx wrangler secret put ADMIN_PASSWORD` (choose a strong password; `ADMIN_USERNAME` defaults to `admin` via `vars`)
6. `npm run deploy`

## Dashboard deployment guide (面板部署)

Notetion uses **SQLite-backed Durable Objects** (`SyncHub`, `CredentialVault`) declared via
`migrations: [{ tag: "v1", new_sqlite_classes: [...] }]` in `wrangler.jsonc`. Registering those
classes with the SQLite backend is a Workers migration event that the Cloudflare Dashboard UI
cannot trigger — so the actual code deploy still needs `wrangler deploy` (or the Workers deploy
API). The Dashboard is, however, the better interface for resource provisioning, secrets,
cron triggers, and monitoring. This section covers that hybrid flow.

### Dashboard vs. CLI — what each is good for

| Task | Dashboard | `wrangler` |
| --- | --- | --- |
| Create D1 / KV / Queue resources | ✅ click-friendly | ✅ |
| Configure vars & secrets | ✅ UI, masked after entry | ✅ `wrangler secret put` |
| Configure cron triggers | ✅ UI | ✅ via `wrangler.jsonc` |
| Run D1 migrations | ⚠️ SQL editor only (manual, per-file) | ✅ `d1 migrations apply --remote` |
| Deploy worker bundle | ⚠️ upload pre-built bundle (no build step) | ✅ `vite build` + deploy |
| Register SQLite-backed DO classes | ❌ **not possible** — requires `wrangler deploy` | ✅ automatic via `migrations` tag |
| View logs & analytics | ✅ best (tail, filters, histograms) | ⚠️ `wrangler tail` only |
| Iterative local dev | ❌ | ✅ `npm run dev` |

**Recommendation:** create resources and configure secrets/triggers in the Dashboard (Steps 1,
5, 6), verify with the Dashboard (Step 8), but deploy code and apply migrations with `wrangler`
(Steps 4, 7).

### Step 1 — Create resources in the Dashboard

All entries are under **Workers & Pages** in the left sidebar.

1. **D1 database** — `Workers & Pages` → `D1` → `Create database`
   - Name: `notetion-db`
   - Region: any (reads are globally replicated; writes route to the elected leader)
   - **Copy the `database_id`** (UUID) — you'll paste it into `wrangler.jsonc`
2. **KV namespace** — `Workers & Pages` → `Key-Value` → `Create namespace`
   - Name: `FILES_KV`
   - TTL: leave at the default (attachments should outlive 30 days)
   - **Copy the `id`** (32-char hex)
3. **Queue** — `Workers & Pages` → `Queues` → `Create queue`
   - Name: `embedding-queue`
   - Message retention: `7 days` (default is fine)
   - Max batch size: `10` (must match `wrangler.jsonc`)

### Step 2 — Fill the real IDs into `wrangler.jsonc`

```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "notetion-db",
  "database_id": "<paste the UUID from Step 1>",
  "migrations_dir": "migrations"
}],
"kv_namespaces": [{
  "binding": "FILES_KV",
  "id": "<paste the 32-char hex from Step 1>"
}],
```

### Step 3 — Build locally

```sh
npm install
npm run build          # → dist/client/  +  dist/notetion/  (+ dist/notetion/wrangler.json)
```

If your shell forces global npm (this dev machine does — `NPM_CONFIG_GLOBAL=true`), prefix
with `NPM_CONFIG_GLOBAL=false`.

### Step 4 — Deploy the worker

**Option A — `wrangler deploy` (recommended)**

```sh
npx wrangler deploy
```

This applies the `migrations: [{ tag: "v1", new_sqlite_classes: ["SyncHub", "CredentialVault"] }]`
entry, registering both DO classes with the SQLite backend. Skipping this step makes every
DO route fail at runtime with `Durable Object class not found`.

**Option B — Dashboard upload**

- `Workers & Pages` → `Create application` → `Workers` → `Upload to Cloudflare`
- Upload the contents of `dist/notetion/` (the `.js` entrypoint + its `.js.map`)
- Paste the contents of `dist/notetion/wrangler.json` into the configuration editor
- Bind the D1 / KV / Queue resources in the UI (Step 5 equivalent)

⚠️ The Dashboard cannot register SQLite-backed DO classes. If you deploy this way as your
**first** deploy, run `npx wrangler deploy` once immediately after to apply the DO migration —
after that, future Dashboard uploads will work.

### Step 5 — Configure variables and secrets

`Workers & Pages` → `notetion` → `Settings` → `Variables and Secrets`:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `ADMIN_USERNAME` | `admin` (or your preferred handle) |
| Variable | `APP_VERSION` | `0.1.0` |
| Secret | `ADMIN_PASSWORD` | *pick a strong password (16+ chars, mixed case / digits / symbols)* |

Secrets are masked in the UI after creation. The values in `wrangler.jsonc` → `vars` are
build-time defaults; Dashboard values override them.

### Step 6 — Configure cron triggers

`Workers & Pages` → `notetion` → `Settings` → `Cron Triggers` → `Add`:

| Schedule | Purpose |
| --- | --- |
| `17 3 * * *` | Daily housekeeping — purge expired sessions, hard-delete trashed notes past 30 days, trim version snapshots beyond retention (default 50/note) |
| `0 */6 * * *` | Scheduled backup check — evaluate each `backup_configs` row for a matching cron expression and fire off-site backups |

Both crons run the full `scheduled()` handler, which always calls `runCleanup()` and then
`runScheduledBackups(cron)`.

### Step 7 — Apply D1 migrations

**Option A — `wrangler` (recommended):**

```sh
npx wrangler d1 migrations apply notetion-db --remote
```

**Option B — Dashboard:** `Workers & Pages` → `D1` → `notetion-db` → `Schema` tab → paste and
run each SQL file in order. The Schema editor has no native "migrations directory" importer, so
this is 8 manual pastes.

| # | File | Adds |
| --- | --- | --- |
| 1 | `0001_init.sql` | `accounts`, `notes`, `folders`, `tags`, `note_versions`, `note_version_retention`, `settings`, `sessions`, `recents` |
| 2 | `0002_files.sql` | `files` — attachment metadata (blobs live in `FILES_KV`) |
| 3 | `0003_search.sql` | `notes_fts` — FTS5 virtual table (`unicode61`, `remove_diacritics=2`) |
| 4 | `0004_wiki.sql` | `wiki_links` — backlinks, block refs, embeds |
| 5 | `0005_mcp.sql` | `api_keys`, OAuth 2.1 state (`oauth_authorizations`, `oauth_tokens`, `oauth_grants`) |
| 6 | `0006_ai.sql` | `note_embeddings` — per-note vectors as JSON (Workers AI `@cf/baai/bge-small-en-v1.5`) |
| 7 | `0007_sharing.sql` | `shares` — public links, passphrase hash, expiry, view count |
| 8 | `0008_backups.sql` | `backup_configs`, `backup_history` |

### Step 8 — Verify

1. `Workers & Pages` → `notetion` → `Analytics` — confirm `200 OK` responses and no `5xx` spikes.
2. Open `https://notetion.<your-subdomain>.workers.dev` — the login page should load.
3. Log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. First login creates the admin account and
   seeds two starter notes (Traditional Chinese + English).
4. `Workers & Pages` → `notetion` → `Logs` — watch for errors. Common early red flags:
   - `Durable Object class not found` → Step 4 (DO migration) was skipped; run `wrangler deploy` once.
   - `no such table: notes` → Step 7 (migrations) not applied.
   - Login loops back to the login page → `ADMIN_PASSWORD` secret is unset or mismatched (Step 5).
5. `Workers & Pages` → `Queues` → `embedding-queue` — confirm `Messages received` /
   `Messages delivered` advance after the first note save (AI search, M6).

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `npm install` lands in the wrong prefix | `NPM_CONFIG_GLOBAL=true` in shell | `NPM_CONFIG_GLOBAL=false npm install` |
| `deploy` fails: `database_id` placeholder | Step 2 not done | Paste the real UUID into `wrangler.jsonc` |
| Worker 500s, `Durable Object class not found` | SQLite DO migration skipped | Run `npx wrangler deploy` once (Step 4) |
| Worker 500s, `no such table` | Migrations not applied | `wrangler d1 migrations apply --remote` (Step 7) |
| Login loops back to login page | `ADMIN_PASSWORD` secret missing | Set it in Step 5 |
| Attachments 404 after upload | `FILES_KV` binding missing or wrong id | Rebind in `wrangler.jsonc` and re-deploy |
| Semantic search returns nothing | Workers AI binding not set, or queue empty | Confirm the `ai` binding in `wrangler.jsonc`; check the Queue dashboard |
| Scheduled backups never fire | `backup_configs.schedule` is NULL | Set a cron expression in the Backup Manager UI (M8) |

## Roadmap

- [x] **M0** scaffold: env-credential admin auth, notes/folders API + UI, autosave, version snapshots, trash/restore, i18n (zh-TW/en), themes, starter-note seeding, DO stubs, cleanup cron
- [x] **M1** writing core: CodeMirror 6, independent title, desktop dual panes, per-pane edit/split/preview, sync scroll, outline, focus & typewriter modes, drag-sort folders, body tags, attachments (KV), favorite/pin/archive UI
- [x] **M2** search & history: D1 FTS5 (unicode61 tokenizer, CJK character-by-character), command palette (Ctrl/Cmd+K), recents, version-history UI with restore, version retention cron (default 50 snapshots/note)
- [x] **M3** offline & sync: installable PWA (manifest.json + sw.js), IndexedDB cache (notes/folders/pending writes), offline write queue with auto-sync on reconnect, optimistic concurrency (local-first then sync), SyncHub DO WebSocket (Hibernation API), online/offline state tracking
- [x] **M4** wiki: WikiLinks ([[title]]), backlinks panel, block refs ([[title#^id]]), embeds (![[title]]), Obsidian comments (%%...%%), callouts (> [!tip]), KaTeX math, Mermaid diagrams, knowledge graph view
- [x] **M5** MCP & API: API keys (ink_... prefix, revocable, scoped permissions), OAuth 2.1 + PKCE (D1 state), MCP endpoints (/mcp/notes, /mcp/search), chunked reading (10k chars/chunk), version-safe writes, API key management UI
- [x] **M6** AI search: Workers AI embeddings (@cf/baai/bge-small-en-v1.5, 384-dim), per-note vectors in D1 (JSON), hybrid search (FTS5 + cosine similarity with RRF), background embedding queue (Queues), semantic search toggle () in command palette
- [x] **M7** sharing & export: public share links (/s/:slug with optional passphrase + expiry), JSON/Markdown export, share management UI, export manager UI
- [x] **M8** backups: CredentialVault DO (AES-GCM-256 encrypted credentials), WebDAV client, S3 client (SigV4), backup API (manual + scheduled via cron), backup history tracking, backup manager UI
- [x] **M9** polish: mobile layout optimization, accent color picker (6 colors), complete zh-TW/en UI coverage, admin-only version update notices, settings panel

## Security notes (M0)

- Session tokens: 32 random bytes; only SHA-256 hashes stored; `HttpOnly` + `SameSite=Lax`
  (+ `Secure` / `__Host-` prefix in production), 30-day expiry, daily cron purge.
- Admin password comparison is constant-time (digest XOR).
- TODO before public deploy: login rate limiting (e.g. Turnstile, free), CSP headers,
  and request size limits.

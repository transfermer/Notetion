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

## Type checking
`npm run typecheck` needs the generated `Env` types, which include secrets only when `.dev.vars` exists:
`cp .dev.vars.example .dev.vars && npm run types && npm run typecheck`
(the script runs `src/` first and stops on its first error, so worker/ errors can appear only after src/ is clean).

## Deploy checklist (when ready)

1. `npx wrangler login` (or export `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`)
2. `npx wrangler d1 create notetion-db` → replace `database_id` in `wrangler.jsonc`
3. `npx wrangler kv namespace create FILES_KV` → replace `id` in `wrangler.jsonc`
4. `npx wrangler d1 migrations apply notetion-db --remote`
5. `npx wrangler secret put ADMIN_PASSWORD` (choose a strong password; `ADMIN_USERNAME` defaults to `admin` via `vars`)
6. `openssl rand -base64 48` → `npx wrangler secret put BACKUP_ENCRYPTION_KEY` (only needed for off-site backups; credentials are stored AES-GCM-encrypted with it. Losing/rotating it makes saved backup configs unreadable — re-create them)
7. `npm run deploy`

## Deploy from the Cloudflare dashboard (Git-connected, no local wrangler login)

Notetion is a **Worker with static assets** (not a Pages project), so it is deployed through
*Workers & Pages → Create → Import a repository* (Workers Builds). Button labels may differ slightly between dashboard versions.

**1. Create the resources once (dashboard → Storage & databases)**
- **D1** → Create database `notetion-db` → copy its *Database ID*.
- **KV** → Create namespace `FILES_KV` → copy its *Namespace ID*.
- **Queues** → Create queue `embedding-queue` (the Worker binds to it; deploy fails if it does not exist).
  Embeddings use Workers AI, which is optional — search works without it.

**2. Put the IDs in `wrangler.jsonc` and push to your Git repo**
- `d1_databases[0].database_id` ← the D1 ID
- `kv_namespaces[0].id` ← the KV ID
(IDs are identifiers, not secrets, so committing them is fine.)

**3. Import the repository**
- Workers & Pages → Create → *Import a repository* → pick the repo, branch `main`.
- Worker name must equal `"name"` in `wrangler.jsonc` (`notetion`).
- Build command: `npm run build`
- Deploy command: `npx wrangler d1 migrations apply notetion-db --remote && npx wrangler deploy`
  (applies new migrations on every deploy, then publishes; already-applied migrations are skipped).
- If the build says `vite: not found`, dev dependencies were skipped: add a build variable `NODE_ENV=development`
  (or change the build command to `npm install --include=dev && npm run build`).

**4. Set secrets** (Worker → Settings → *Variables and Secrets* → type **Secret**, not plain text)
- `ADMIN_PASSWORD` — required.
- `BACKUP_ENCRYPTION_KEY` — only for off-site backups; generate with `openssl rand -base64 48`, keep a copy
  (losing it makes saved backup configs unreadable).
- Optional plain variables: `ADMIN_USERNAME` (default `admin`; the `vars` block in `wrangler.jsonc` is re-applied on each
  deploy, so change it there), `ENABLE_MCP_OAUTH` (`true` to enable MCP/OAuth/API keys).
  Secrets set in the dashboard survive deploys.

**5. Redeploy and verify**
- Trigger a deploy (push a commit or *Retry deployment*) after setting secrets.
- Open `https://notetion.<your-subdomain>.workers.dev`, check `/api/health`, sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
- Cron triggers (`wrangler.jsonc`) are registered by the deploy; no dashboard setup needed.

Dashboard-only alternative for the database: instead of the migrations command above, open D1 → `notetion-db` → *Console*
and paste each file from `migrations/` in numeric order (0001 … 0009). Prefer the command; it tracks what was applied.

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

## MCP / OAuth / API keys (disabled by default)
The `/mcp`, `/oauth`, `/api/oauth` and `/api/api-keys` endpoints only serve external tools and return 404 unless
`ENABLE_MCP_OAUTH` is `"true"` (set it under `vars` in `wrangler.jsonc`, or in `.dev.vars` locally).

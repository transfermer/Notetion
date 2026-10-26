/**
 * Framework-free autosave controller for one open note.
 *
 * Why this exists: the previous implementation kept its save logic inside
 * EditorPane closures. CodeMirror is mounted once and kept the *first* render's
 * `onChange`, so later saves used a stale title / noteId / version. This class
 * owns all mutable save state itself (no closures over component renders), so
 * a single instance always saves to the note it was created for.
 *
 * Guarantees:
 *  - one PATCH in flight at a time (no self-inflicted 409s); edits made while a
 *    save is running are saved right after it, using the NEW version;
 *  - pending edits are flushed on dispose()/pagehide, never silently dropped;
 *  - on a real conflict the local draft is KEPT; the caller chooses
 *    keepMine() (overwrite) or discardMine() (reload);
 *  - failed saves retry automatically.
 */

export type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export interface SavedNote {
  version: number;
  title: string;
  content: string;
}

export interface SavePatch {
  title: string;
  content: string;
  base_version: number;
}

export interface AutosaveOptions {
  /** Perform the PATCH. Must throw on failure. */
  save: (patch: SavePatch, keepalive: boolean) => Promise<SavedNote>;
  /** If `err` is a version conflict, return the server's current note; else null. */
  asConflict: (err: unknown) => SavedNote | null;
  onState?: (state: SaveState) => void;
  onSaved?: (saved: SavedNote) => void;
  delayMs?: number;
  retryMs?: number;
  /** Automatic retries after a failed save before waiting for the next edit. */
  maxRetries?: number;
}

export class AutosaveController {
  private base: SavedNote;
  private draft: { title: string; content: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> | null = null;
  private blocked = false;
  private disposed = false;
  private serverNote: SavedNote | null = null;
  private _state: SaveState = "idle";
  private retries = 0;

  private readonly opts: AutosaveOptions;

  constructor(base: SavedNote, opts: AutosaveOptions) {
    this.base = { ...base };
    this.opts = opts;
  }

  get state(): SaveState {
    return this._state;
  }

  /** Latest unsaved text, or null if everything is saved. */
  get unsaved(): { title: string; content: string } | null {
    return this.hasUnsaved() ? this.draft : null;
  }

  get version(): number {
    return this.base.version;
  }

  /** Record the latest editor text and (re)start the debounce timer. */
  update(title: string, content: string): void {
    if (this.disposed) return;
    this.draft = { title, content };
    this.retries = 0;
    if (this._state === "conflict") return; // keep collecting, don't save until resolved
    this.schedule(this.opts.delayMs ?? 800);
  }

  /** Save now (resolves when everything pending is saved or failed). */
  flush(keepalive = false): Promise<void> {
    clearTimeout(this.timer);
    if (this.inflight) return this.inflight;
    if (this.blocked || this._state === "conflict" || !this.hasUnsaved()) return Promise.resolve();
    this.inflight = this.run(keepalive).finally(() => {
      this.inflight = null;
      if (!this.disposed && this.hasUnsaved() && this._state !== "conflict" && this._state !== "error") {
        this.schedule(this.opts.delayMs ?? 800);
      }
    });
    return this.inflight;
  }

  /**
   * Run `fn` (e.g. a favorite/pin PATCH that bumps the server version) with
   * autosave paused, then adopt the returned note as the new base.
   */
  async exclusive<T extends SavedNote>(fn: () => Promise<T>): Promise<T> {
    await this.flush();
    this.blocked = true;
    try {
      const saved = await fn();
      // Only the version moves; text fields stay as the editor has them.
      this.base = { ...this.base, version: saved.version };
      return saved;
    } finally {
      this.blocked = false;
      if (!this.disposed && this.hasUnsaved() && this._state !== "conflict") {
        this.schedule(this.opts.delayMs ?? 800);
      }
    }
  }

  /** Conflict resolution: overwrite the server version with the local draft. */
  keepMine(): Promise<void> {
    if (this._state !== "conflict" || !this.serverNote) return Promise.resolve();
    this.base = { ...this.serverNote };
    this.serverNote = null;
    this.setState("idle");
    return this.flush();
  }

  /** Conflict resolution: forget the local draft (caller reloads from server). */
  discardMine(): void {
    this.draft = null;
    this.serverNote = null;
    clearTimeout(this.timer);
    this.setState("idle");
  }

  /** Stop the controller; pending edits are flushed (fire-and-forget). */
  dispose(): void {
    if (this.disposed) return;
    const p = this.flush(true);
    this.disposed = true;
    clearTimeout(this.timer);
    void p;
  }

  // ---- internals ----

  private hasUnsaved(): boolean {
    const d = this.draft;
    return !!d && (d.title !== this.base.title || d.content !== this.base.content);
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private setState(s: SaveState): void {
    this._state = s;
    if (!this.disposed) this.opts.onState?.(s);
  }

  private async run(keepalive: boolean): Promise<void> {
    while (this.hasUnsaved() && !this.blocked) {
      const sent = this.draft!;
      this.setState("saving");
      try {
        const saved = await this.opts.save(
          { title: sent.title, content: sent.content, base_version: this.base.version },
          keepalive,
        );
        this.base = { version: saved.version, title: saved.title, content: saved.content };
        this.retries = 0;
        if (this.draft === sent) this.draft = null; // else: newer edits arrived mid-flight → loop again
        if (!this.disposed) this.opts.onSaved?.(saved);
      } catch (err) {
        const server = this.opts.asConflict(err);
        if (server) {
          this.serverNote = server;
          this.setState("conflict");
        } else {
          this.setState("error");
          if (!this.disposed && this.retries++ < (this.opts.maxRetries ?? 5)) {
            this.schedule(this.opts.retryMs ?? 3000);
          }
        }
        return;
      }
    }
    this.setState(this.hasUnsaved() ? "saving" : "saved");
  }
}

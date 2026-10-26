import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { relTime } from "../i18n";

interface Share {
  id: string;
  note_id: string;
  slug: string;
  has_passphrase: boolean;
  expires_at: number | null;
  view_count: number;
  created_at: number;
  note_title: string;
}

interface Props {
  noteId: string | null;
  open: boolean;
  onClose: () => void;
}

export function ShareManager(props: Props) {
  const [shares, setShares] = useState<Share[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [expiresDays, setExpiresDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdShare, setCreatedShare] = useState<{ slug: string } | null>(null);

  useEffect(() => {
    if (props.open) {
      loadShares();
    }
  }, [props.open]);

  async function loadShares() {
    setLoading(true);
    try {
      const res = await api.getShares();
      setShares(res.shares);
    } catch (err) {
      console.error("load shares failed", err);
    } finally {
      setLoading(false);
    }
  }

  async function createShare() {
    if (!props.noteId) return;
    try {
      const res = await api.createShare({
        note_id: props.noteId,
        passphrase: passphrase || undefined,
        expires_in_days: expiresDays || undefined,
      });
      // Use the response directly: `shares` here is a stale closure value from before loadShares().
      setCreatedShare({ slug: res.share.slug });
      await loadShares();
      setPassphrase("");
      setExpiresDays(null);
    } catch (err) {
      console.error("create share failed", err);
    }
  }

  async function deleteShare(id: string) {
    if (!confirm("Delete this share link? It will no longer be accessible.")) return;
    try {
      await api.deleteShare(id);
      await loadShares();
    } catch (err) {
      console.error("delete share failed", err);
    }
  }

  function getShareUrl(slug: string): string {
    return `${window.location.origin}/s/${slug}`;
  }

  if (!props.open) return null;

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Share Note</h2>
          <button class="btn ghost small" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div class="share-manager">
          {createdShare && (
            <div class="created-share-notice">
              <p><strong>Share link created!</strong></p>
              <code class="share-url">{getShareUrl(createdShare.slug)}</code>
              <button class="btn small" onClick={() => navigator.clipboard.writeText(getShareUrl(createdShare.slug))}>
                Copy
              </button>
              <button class="btn ghost small" onClick={() => setCreatedShare(null)}>
                Dismiss
              </button>
            </div>
          )}

          <div class="create-share-form">
            <label class="field">
              <span>Passphrase (optional)</span>
              <input
                type="password"
                placeholder="Leave empty for public access"
                value={passphrase}
                onInput={(e) => setPassphrase(e.currentTarget.value)}
              />
            </label>
            <label class="field">
              <span>Expires in days (optional)</span>
              <input
                type="number"
                placeholder="Never"
                value={expiresDays ?? ""}
                onInput={(e) => {
                  const val = e.currentTarget.value;
                  setExpiresDays(val ? parseInt(val, 10) : null);
                }}
              />
            </label>
            <button class="btn primary" onClick={createShare} disabled={!props.noteId}>
              Create Share Link
            </button>
          </div>

          <div class="shares-list">
            <h3>Your Share Links</h3>
            {loading && <div class="loading">Loading…</div>}
            {!loading && shares.length === 0 && <div class="empty">No share links yet</div>}
            {shares.map((share) => (
              <div key={share.id} class="share-item">
                <div class="share-info">
                  <div class="share-note-title">{share.note_title}</div>
                  <div class="share-url">{getShareUrl(share.slug)}</div>
                  <div class="share-meta">
                    {share.has_passphrase && <span class="share-badge"></span>}
                    {share.expires_at && <span>Expires: {relTime(share.expires_at)}</span>}
                    <span>{share.view_count} views</span>
                    <span>Created: {relTime(share.created_at)}</span>
                  </div>
                </div>
                <button class="btn danger small" onClick={() => deleteShare(share.id)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

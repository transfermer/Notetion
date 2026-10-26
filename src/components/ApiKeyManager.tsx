import { useEffect, useState } from "preact/hooks";
import { api } from "../api";

interface ApiKey {
  id: string;
  name: string;
  permissions: string[];
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

interface ApiKeyWithToken extends ApiKey {
  token: string;
}

export function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPermissions, setNewKeyPermissions] = useState<string[]>(["read"]);
  const [newKeyExpiresDays, setNewKeyExpiresDays] = useState<number | null>(null);
  const [createdKey, setCreatedKey] = useState<ApiKeyWithToken | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadKeys();
  }, []);

  async function loadKeys() {
    setLoading(true);
    try {
      const res = await api.getApiKeys();
      setKeys(res.keys);
    } catch (err) {
      console.error("load api keys failed", err);
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    if (!newKeyName.trim()) return;
    try {
      const res = await api.createApiKey({
        name: newKeyName,
        permissions: newKeyPermissions,
        expires_in_days: newKeyExpiresDays,
      });
      setCreatedKey(res.key);
      setNewKeyName("");
      await loadKeys();
    } catch (err) {
      console.error("create api key failed", err);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this API key? It will no longer work.")) return;
    try {
      await api.revokeApiKey(id);
      await loadKeys();
    } catch (err) {
      console.error("revoke api key failed", err);
    }
  }

  function togglePermission(perm: string) {
    setNewKeyPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  }

  return (
    <div class="api-key-manager">
      <h2>API Keys</h2>

      {createdKey && (
        <div class="created-key-notice">
          <p><strong>Save this token now!</strong> It will never be shown again.</p>
          <code class="token-display">{createdKey.token}</code>
          <button class="btn small" onClick={() => navigator.clipboard.writeText(createdKey.token)}>
            Copy
          </button>
          <button class="btn ghost small" onClick={() => setCreatedKey(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div class="create-key-form">
        <input
          type="text"
          placeholder="Key name"
          value={newKeyName}
          onInput={(e) => setNewKeyName(e.currentTarget.value)}
        />
        <div class="permissions">
          {["read", "write", "delete", "trash"].map((perm) => (
            <label key={perm} class="permission-checkbox">
              <input
                type="checkbox"
                checked={newKeyPermissions.includes(perm)}
                onChange={() => togglePermission(perm)}
              />
              {perm}
            </label>
          ))}
        </div>
        <input
          type="number"
          placeholder="Expires in days (optional)"
          value={newKeyExpiresDays ?? ""}
          onInput={(e) => {
            const val = e.currentTarget.value;
            setNewKeyExpiresDays(val ? parseInt(val, 10) : null);
          }}
        />
        <button class="btn primary" onClick={createKey} disabled={!newKeyName.trim()}>
          Create Key
        </button>
      </div>

      <div class="keys-list">
        {loading && <div class="loading">Loading…</div>}
        {!loading && keys.length === 0 && <div class="empty">No API keys yet</div>}
        {keys.map((key) => (
          <div key={key.id} class="key-item">
            <div class="key-info">
              <div class="key-name">{key.name}</div>
              <div class="key-meta">
                Created: {new Date(key.created_at).toLocaleDateString()}
                {key.expires_at && ` · Expires: ${new Date(key.expires_at).toLocaleDateString()}`}
                {key.last_used_at && ` · Last used: ${new Date(key.last_used_at).toLocaleDateString()}`}
              </div>
              <div class="key-permissions">
                {key.permissions.map((p) => (
                  <span key={p} class="permission-tag">{p}</span>
                ))}
              </div>
            </div>
            <button class="btn danger small" onClick={() => revokeKey(key.id)}>
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

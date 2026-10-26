import { useEffect, useState } from "preact/hooks";
import { api } from "../api";

interface BackupConfig {
  id: string;
  type: "webdav" | "s3";
  name: string;
  enabled: number;
  schedule: string | null;
  created_at: number;
  updated_at: number;
}

interface BackupHistory {
  id: string;
  config_id: string;
  config_name: string;
  status: string;
  started_at: number;
  completed_at: number | null;
  bytes_uploaded: number;
  notes_backed_up: number;
  files_backed_up: number;
  error: string | null;
  created_at: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function errorDetail(err: unknown): string {
  const data = (err as { data?: { detail?: unknown } } | null)?.data;
  const detail = data && typeof data.detail === "string" ? data.detail : "";
  const base = err instanceof Error ? err.message : String(err);
  return detail ? `${base} (${detail})` : base;
}

export function BackupManager(props: Props) {
  const [configs, setConfigs] = useState<BackupConfig[]>([]);
  const [history, setHistory] = useState<BackupHistory[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [backupType, setBackupType] = useState<"webdav" | "s3">("webdav");
  const [backupName, setBackupName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUsername, setWebdavUsername] = useState("");
  const [webdavPassword, setWebdavPassword] = useState("");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    if (props.open) {
      loadConfigs();
      loadHistory();
    }
  }, [props.open]);

  async function loadConfigs() {
    setLoading(true);
    try {
      const res = await api.getBackupConfigs();
      setConfigs(res.configs);
    } catch (err) {
      console.error("load backup configs failed", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const res = await api.getBackupHistory();
      setHistory(res.history);
    } catch (err) {
      console.error("load backup history failed", err);
    }
  }

  async function createConfig() {
    if (!backupName.trim()) return;

    const config =
      backupType === "webdav"
        ? {
            url: webdavUrl,
            username: webdavUsername,
            password: webdavPassword,
          }
        : {
            endpoint: s3Endpoint,
            region: s3Region,
            bucket: s3Bucket,
            accessKeyId: s3AccessKey,
            secretAccessKey: s3SecretKey,
          };

    try {
      await api.createBackupConfig({
        type: backupType,
        name: backupName,
        config,
        schedule: schedule || undefined,
      });
      setBackupName("");
      setSchedule("");
      setWebdavUrl("");
      setWebdavUsername("");
      setWebdavPassword("");
      setS3Endpoint("");
      setS3Region("");
      setS3Bucket("");
      setS3AccessKey("");
      setS3SecretKey("");
      setShowCreateForm(false);
      await loadConfigs();
    } catch (err) {
      console.error("create backup config failed", err);
      alert(`Failed to create backup config: ${errorDetail(err)}`);
    }
  }

  async function deleteConfig(id: string) {
    if (!confirm("Delete this backup configuration?")) return;
    try {
      await api.deleteBackupConfig(id);
      await loadConfigs();
    } catch (err) {
      console.error("delete backup config failed", err);
    }
  }

  async function runBackup(configId: string) {
    setBackingUp(true);
    try {
      await api.runBackup(configId);
      await loadHistory();
      alert("Backup completed!");
    } catch (err) {
      console.error("run backup failed", err);
      alert(`Backup failed: ${errorDetail(err)}`);
    } finally {
      setBackingUp(false);
    }
  }

  if (!props.open) return null;

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Off-site Backups</h2>
          <button class="btn ghost small" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div class="backup-manager">
          {showCreateForm ? (
            <div class="create-backup-form">
              <h3>Create Backup Configuration</h3>

              <label class="field">
                <span>Name</span>
                <input
                  type="text"
                  placeholder="e.g. My WebDAV Backup"
                  value={backupName}
                  onInput={(e) => setBackupName(e.currentTarget.value)}
                />
              </label>

              <label class="field">
                <span>Type</span>
                <select value={backupType} onChange={(e) => setBackupType(e.currentTarget.value as "webdav" | "s3")}>
                  <option value="webdav">WebDAV</option>
                  <option value="s3">S3 Compatible</option>
                </select>
              </label>

              {backupType === "webdav" ? (
                <>
                  <label class="field">
                    <span>WebDAV URL</span>
                    <input
                      type="url"
                      placeholder="https://dav.example.com/backups/"
                      value={webdavUrl}
                      onInput={(e) => setWebdavUrl(e.currentTarget.value)}
                    />
                  </label>
                  <label class="field">
                    <span>Username</span>
                    <input
                      type="text"
                      value={webdavUsername}
                      onInput={(e) => setWebdavUsername(e.currentTarget.value)}
                    />
                  </label>
                  <label class="field">
                    <span>Password</span>
                    <input
                      type="password"
                      value={webdavPassword}
                      onInput={(e) => setWebdavPassword(e.currentTarget.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label class="field">
                    <span>Endpoint</span>
                    <input
                      type="url"
                      placeholder="https://s3.amazonaws.com"
                      value={s3Endpoint}
                      onInput={(e) => setS3Endpoint(e.currentTarget.value)}
                    />
                  </label>
                  <label class="field">
                    <span>Region</span>
                    <input
                      type="text"
                      placeholder="us-east-1"
                      value={s3Region}
                      onInput={(e) => setS3Region(e.currentTarget.value)}
                    />
                  </label>
                  <label class="field">
                    <span>Bucket</span>
                    <input
                      type="text"
                      placeholder="my-backup-bucket"
                      value={s3Bucket}
                      onInput={(e) => setS3Bucket(e.currentTarget.value)}
                    />
                  </label>
                  <label class="field">
                    <span>Access Key ID</span>
                    <input
                      type="text"
                      value={s3AccessKey}
                      onInput={(e) => setS3AccessKey(e.currentTarget.value)}
                    />
                  </label>
                  <label class="field">
                    <span>Secret Access Key</span>
                    <input
                      type="password"
                      value={s3SecretKey}
                      onInput={(e) => setS3SecretKey(e.currentTarget.value)}
                    />
                  </label>
                </>
              )}

              <label class="field">
                <span>Schedule</span>
                <select value={schedule} onChange={(e) => setSchedule(e.currentTarget.value)}>
                  <option value="">Manual only</option>
                  <option value="daily">Daily (about 03:17 UTC)</option>
                  <option value="6h">Every 6 hours</option>
                </select>
              </label>

              <div class="form-actions">
                <button class="btn" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </button>
                <button class="btn primary" onClick={createConfig} disabled={!backupName.trim()}>
                  Create
                </button>
              </div>
            </div>
          ) : (
            <>
              <button class="btn primary" onClick={() => setShowCreateForm(true)}>
                + Add Backup Configuration
              </button>

              <div class="configs-list">
                <h3>Backup Configurations</h3>
                {loading && <div class="loading">Loading…</div>}
                {!loading && configs.length === 0 && <div class="empty">No backup configurations yet</div>}
                {configs.map((config) => (
                  <div key={config.id} class="config-item">
                    <div class="config-info">
                      <div class="config-name">{config.name}</div>
                      <div class="config-meta">
                        <span class="config-type">{config.type.toUpperCase()}</span>
                        {config.schedule && <span>Schedule: {config.schedule === "6h" ? "every 6 hours" : config.schedule === "daily" ? "daily" : config.schedule}</span>}
                        <span>Created: {new Date(config.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div class="config-actions">
                      <button class="btn small" onClick={() => runBackup(config.id)} disabled={backingUp}>
                        {backingUp ? "Backing up…" : "Backup Now"}
                      </button>
                      <button class="btn danger small" onClick={() => deleteConfig(config.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div class="history-list">
                <h3>Backup History</h3>
                {history.length === 0 && <div class="empty">No backup history yet</div>}
                {history.map((h) => (
                  <div key={h.id} class={`history-item status-${h.status}`}>
                    <div class="history-info">
                      <div class="history-config">{h.config_name}</div>
                      <div class="history-meta">
                        <span class={`status-badge status-${h.status}`}>{h.status}</span>
                        <span>{new Date(h.started_at).toLocaleString()}</span>
                        {h.completed_at && <span>Duration: {Math.round((h.completed_at - h.started_at) / 1000)}s</span>}
                        <span>{h.notes_backed_up} notes</span>
                        <span>{(h.bytes_uploaded / 1024).toFixed(1)} KB</span>
                      </div>
                      {h.error && <div class="history-error">{h.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

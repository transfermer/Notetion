import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";

interface Props {
  currentVersion: string;
  open: boolean;
  onClose: () => void;
}

interface UpdateNotice {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

// Hardcoded update history (in production, this could come from an API).
const UPDATE_HISTORY: UpdateNotice[] = [
  {
    version: "0.9.0",
    date: "2026-10-25",
    title: "M9 — Final Polish",
    changes: [
      "Mobile-optimized layout with touch-friendly targets",
      "Accent color picker (6 colors: Indigo, Emerald, Rose, Amber, Sky, Violet)",
      "Complete zh-TW / English UI coverage",
      "Admin-only version update notices",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-10-25",
    title: "M8 — Off-site Backups",
    changes: [
      "CredentialVault DO with AES-GCM-256 encrypted credentials",
      "WebDAV client (PUT/MKCOL/DELETE)",
      "S3 client with SigV4 signing (compatible with AWS S3, R2, MinIO)",
      "Backup API with manual trigger and cron scheduling",
      "Backup history tracking",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-10-25",
    title: "M7 — Sharing & Export",
    changes: [
      "Public share links with optional passphrase and expiry",
      "JSON and Markdown export",
      "Share management UI",
      "Export manager UI",
    ],
  },
];

export const seenVersion = signal<string>("0.0.0");

export function VersionNotices(props: Props) {
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("notetion.dismissed_versions");
      if (stored) setDismissed(JSON.parse(stored));
    } catch {}
  }, []);

  if (!props.open) return null;

  const unseenNotices = UPDATE_HISTORY.filter(
    (n) => n.version > props.currentVersion && !dismissed.includes(n.version),
  );

  function dismissVersion(version: string) {
    const newDismissed = [...dismissed, version];
    setDismissed(newDismissed);
    try {
      localStorage.setItem("notetion.dismissed_versions", JSON.stringify(newDismissed));
    } catch {}
  }

  function dismissAll() {
    const allVersions = UPDATE_HISTORY.map((n) => n.version);
    setDismissed(allVersions);
    try {
      localStorage.setItem("notetion.dismissed_versions", JSON.stringify(allVersions));
    } catch {}
    props.onClose();
  }

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal-content notices-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Version Updates</h2>
          <button class="btn ghost small" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div class="notices-body">
          {unseenNotices.length === 0 && (
            <div class="empty">You're up to date!</div>
          )}

          {unseenNotices.map((notice) => (
            <div key={notice.version} class="notice-item">
              <div class="notice-header">
                <div class="notice-version">v{notice.version}</div>
                <div class="notice-date">{notice.date}</div>
              </div>
              <h3 class="notice-title">{notice.title}</h3>
              <ul class="notice-changes">
                {notice.changes.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
              <button
                class="btn ghost small"
                onClick={() => dismissVersion(notice.version)}
              >
                Dismiss
              </button>
            </div>
          ))}

          {unseenNotices.length > 0 && (
            <div class="notices-actions">
              <button class="btn primary" onClick={dismissAll}>
                Dismiss All
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from "preact/hooks";
import { api } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ExportManager(props: Props) {
  const [format, setFormat] = useState<"json" | "markdown" | "zip">("json");
  const [exporting, setExporting] = useState(false);

  async function doExport() {
    setExporting(true);
    try {
      const res = await api.exportNotes(format);

      if (format === "json") {
        const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
        downloadBlob(blob, `notetion-export-${Date.now()}.json`);
      } else if (format === "markdown") {
        // res is a string for markdown.
        const blob = new Blob([res as unknown as string], { type: "text/markdown" });
        downloadBlob(blob, `notetion-export-${Date.now()}.md`);
      } else if (format === "zip") {
        // TODO: Handle ZIP response.
        alert("ZIP export not implemented yet. Use JSON or Markdown.");
      }
    } catch (err) {
      console.error("export failed", err);
      alert("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (!props.open) return null;

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Export Notes</h2>
          <button class="btn ghost small" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div class="export-manager">
          <div class="format-selector">
            <label class="format-option">
              <input
                type="radio"
                name="format"
                value="json"
                checked={format === "json"}
                onChange={() => setFormat("json")}
              />
              <div class="format-info">
                <div class="format-name">JSON</div>
                <div class="format-desc">Structured data with metadata</div>
              </div>
            </label>
            <label class="format-option">
              <input
                type="radio"
                name="format"
                value="markdown"
                checked={format === "markdown"}
                onChange={() => setFormat("markdown")}
              />
              <div class="format-info">
                <div class="format-name">Markdown</div>
                <div class="format-desc">Plain text, human-readable</div>
              </div>
            </label>
            <label class="format-option">
              <input
                type="radio"
                name="format"
                value="zip"
                checked={format === "zip"}
                onChange={() => setFormat("zip")}
                disabled
              />
              <div class="format-info">
                <div class="format-name">ZIP</div>
                <div class="format-desc">Coming soon</div>
              </div>
            </label>
          </div>

          <button class="btn primary" onClick={doExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

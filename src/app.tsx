import { useEffect, useState } from "preact/hooks";
import { account, boot, booting } from "./store";
import { locale } from "./i18n";
import { applyTheme } from "./theme";
import { LoginPage } from "./components/LoginPage";
import { Sidebar } from "./components/Sidebar";
import { Workspace, focusMode } from "./components/Workspace";
import { CommandPalette } from "./components/CommandPalette";
import { ApiKeyManager } from "./components/ApiKeyManager";

export function App() {
  const [commandOpen, setCommandOpen] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);

  useEffect(() => {
    applyTheme();
    void boot();

    // Register service worker for PWA.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch((err) => {
        console.warn("[PWA] Service worker registration failed:", err);
      });
    }

    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Keep <html lang> in sync with the active locale.
  const currentLocale = locale.value;
  useEffect(() => {
    document.documentElement.lang = currentLocale === "zh-TW" ? "zh-TW" : "en";
  }, [currentLocale]);

  if (booting.value) {
    return (
      <div class="splash">
        <div class="splash-logo">N</div>
        <div class="splash-name">Notetion</div>
      </div>
    );
  }

  if (!account.value) return <LoginPage />;

  return (
    <div class="layout">
      {!focusMode.value && <Sidebar onShowApiKeys={() => setShowApiKeys(true)} />}
      <main class="main">
        <Workspace />
      </main>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      {showApiKeys && (
        <div class="modal-overlay" onClick={() => setShowApiKeys(false)}>
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h2>API Keys</h2>
              <button class="btn ghost small" onClick={() => setShowApiKeys(false)}>
                ✕
              </button>
            </div>
            <ApiKeyManager />
          </div>
        </div>
      )}
    </div>
  );
}

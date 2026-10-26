import { useState } from "preact/hooks";
import { ACCENT_COLORS } from "../accents";
import { accent, setAccent, theme, setTheme } from "../theme";
import { locale, setLocale } from "../i18n";
import { t } from "../i18n";
import type { Locale } from "../i18n";
import type { Theme } from "../theme";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel(props: Props) {
  const [localAccent, setLocalAccent] = useState(accent.value);
  const [localTheme, setLocalTheme] = useState<Theme>(theme.value);
  const [localLocale, setLocalLocale] = useState<Locale>(locale.value);

  if (!props.open) return null;

  function applyChanges() {
    setAccent(localAccent);
    setTheme(localTheme);
    setLocale(localLocale);
    props.onClose();
  }

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>{t("settings")}</h2>
          <button class="btn ghost small" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div class="settings-body">
          {/* Theme */}
          <div class="setting-group">
            <label class="setting-label">{t("theme")}</label>
            <div class="theme-selector">
              {(["light", "dark", "system"] as Theme[]).map((th) => (
                <button
                  key={th}
                  class={`theme-option ${localTheme === th ? "selected" : ""}`}
                  onClick={() => setLocalTheme(th)}
                >
                  <span class="theme-icon">{th === "light" ? "☀️" : th === "dark" ? "🌙" : "🖥️"}</span>
                  <span class="theme-name">
                    {th === "light" ? t("light") : th === "dark" ? t("dark") : t("system")}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Accent Color */}
          <div class="setting-group">
            <label class="setting-label">{t("accentColor")}</label>
            <div class="accent-selector">
              {ACCENT_COLORS.map((a) => (
                <button
                  key={a.id}
                  class={`accent-option ${localAccent === a.id ? "selected" : ""}`}
                  onClick={() => setLocalAccent(a.id)}
                  title={a.name}
                >
                  <span
                    class="accent-swatch"
                    style={{ background: a.light.primary }}
                  />
                  <span class="accent-name">{localLocale === "zh-TW" ? a.nameZh : a.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div class="setting-group">
            <label class="setting-label">{t("language")}</label>
            <div class="locale-selector">
              <button
                class={`locale-option ${localLocale === "zh-TW" ? "selected" : ""}`}
                onClick={() => setLocalLocale("zh-TW")}
              >
                正體中文
              </button>
              <button
                class={`locale-option ${localLocale === "en" ? "selected" : ""}`}
                onClick={() => setLocalLocale("en")}
              >
                English
              </button>
            </div>
          </div>

          {/* Apply button */}
          <div class="setting-actions">
            <button class="btn" onClick={props.onClose}>
              {t("cancel")}
            </button>
            <button class="btn primary" onClick={applyChanges}>
              {t("apply")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

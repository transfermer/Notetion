import { useState } from "preact/hooks";
import { ApiError } from "../api";
import { login } from "../store";
import { locale, setLocale, t } from "../i18n";
import { setTheme, theme } from "../theme";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      // success: store.account set → App re-renders into the workspace
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError(t("invalidCredentials"));
        else if (err.status === 500) setError(t("serverMisconfigured"));
        else setError(t("loginFailed"));
      } else {
        setError(t("loginFailed"));
      }
      setBusy(false);
    }
  }

  return (
    <div class="login-page">
      <form class="login-card" onSubmit={onSubmit}>
        <div class="login-logo">N</div>
        <h1>Notetion</h1>
        <p class="login-tagline">{t("tagline")}</p>

        <label class="field">
          <span>{t("username")}</span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            autoFocus
            onInput={(e) => setUsername(e.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>{t("password")}</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </label>

        {error && (
          <div class="error-box" role="alert">
            {error}
          </div>
        )}

        <button class="btn primary" type="submit" disabled={busy}>
          {busy ? t("signingIn") : t("signIn")}
        </button>

        <div class="login-tools">
          <button
            type="button"
            class="btn ghost small"
            title={t("language")}
            onClick={() => setLocale(locale.value === "zh-TW" ? "en" : "zh-TW")}
          >
            {locale.value === "zh-TW" ? "English" : "正體中文"}
          </button>
          <button
            type="button"
            class="btn ghost small"
            title={t("theme")}
            onClick={() => setTheme(theme.value === "dark" ? "light" : "dark")}
          >
            {theme.value === "dark" ? "🌙" : "☀️"}
          </button>
        </div>
      </form>
    </div>
  );
}

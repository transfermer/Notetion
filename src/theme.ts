import { signal } from "@preact/signals";
import { ACCENT_COLORS, getAccentById } from "./accents";

export type Theme = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "notetion.theme";
const ACCENT_STORAGE_KEY = "notetion.accent";

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

function readStoredAccent(): string {
  try {
    const v = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (v && ACCENT_COLORS.some((a) => a.id === v)) return v;
  } catch {}
  return "indigo";
}

export const theme = signal<Theme>(readStoredTheme());
export const accent = signal<string>(readStoredAccent());

function applyAccentColors(accentId: string, isDark: boolean): void {
  const root = document.documentElement;
  const a = getAccentById(accentId);
  const colors = isDark ? a.dark : a.light;

  root.style.setProperty("--accent", colors.primary);
  root.style.setProperty("--accent-soft", colors.soft);
}

export function applyTheme(): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme.value === "dark" || (theme.value === "system" && prefersDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  applyAccentColors(accent.value, dark);
}

export function setTheme(next: Theme): void {
  theme.value = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {}
  applyTheme();
}

export function setAccent(next: string): void {
  accent.value = next;
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, next);
  } catch {}
  applyTheme();
}

// Follow OS theme changes while in "system" mode.
if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (theme.value === "system") applyTheme();
  });
}

/**
 * Accent color system for Notetion.
 * Each accent defines CSS custom properties for primary, soft, and text colors.
 */

export interface AccentColor {
  id: string;
  name: string;
  nameZh: string;
  light: {
    primary: string;
    soft: string;
    text: string;
  };
  dark: {
    primary: string;
    soft: string;
    text: string;
  };
}

export const ACCENT_COLORS: AccentColor[] = [
  {
    id: "indigo",
    name: "Indigo",
    nameZh: "靛藍",
    light: { primary: "#4f6df5", soft: "rgba(79, 109, 245, 0.12)", text: "#4f6df5" },
    dark: { primary: "#6c8cff", soft: "rgba(108, 140, 255, 0.16)", text: "#6c8cff" },
  },
  {
    id: "emerald",
    name: "Emerald",
    nameZh: "翡翠",
    light: { primary: "#059669", soft: "rgba(5, 150, 105, 0.12)", text: "#059669" },
    dark: { primary: "#34d399", soft: "rgba(52, 211, 153, 0.16)", text: "#34d399" },
  },
  {
    id: "rose",
    name: "Rose",
    nameZh: "玫瑰",
    light: { primary: "#e11d48", soft: "rgba(225, 29, 72, 0.12)", text: "#e11d48" },
    dark: { primary: "#fb7185", soft: "rgba(251, 113, 133, 0.16)", text: "#fb7185" },
  },
  {
    id: "amber",
    name: "Amber",
    nameZh: "琥珀",
    light: { primary: "#d97706", soft: "rgba(217, 119, 6, 0.12)", text: "#d97706" },
    dark: { primary: "#fbbf24", soft: "rgba(251, 191, 36, 0.16)", text: "#fbbf24" },
  },
  {
    id: "sky",
    name: "Sky",
    nameZh: "天藍",
    light: { primary: "#0284c7", soft: "rgba(2, 132, 199, 0.12)", text: "#0284c7" },
    dark: { primary: "#38bdf8", soft: "rgba(56, 189, 248, 0.16)", text: "#38bdf8" },
  },
  {
    id: "violet",
    name: "Violet",
    nameZh: "紫羅蘭",
    light: { primary: "#7c3aed", soft: "rgba(124, 58, 237, 0.12)", text: "#7c3aed" },
    dark: { primary: "#a78bfa", soft: "rgba(167, 139, 250, 0.16)", text: "#a78bfa" },
  },
];

export function getAccentById(id: string): AccentColor {
  return ACCENT_COLORS.find((a) => a.id === id) ?? ACCENT_COLORS[0];
}

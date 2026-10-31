import { signal } from "@preact/signals";

/** Per-pane layout — each pane can independently be edit / split / preview. */
export type PaneLayout = "edit" | "split" | "preview";

export interface PaneState {
  id: string;
  layout: PaneLayout;
  noteId: string | null;
  /** Whether this pane is the "active" one (receives new-note / open-note). */
  active: boolean;
}

export const leftPane = signal<PaneState>({
  id: "left",
  layout: "split",
  noteId: null,
  active: true,
});

export const rightPane = signal<PaneState>({
  id: "right",
  layout: "edit",
  noteId: null,
  active: false,
});

const DUAL_KEY = "notetion.dualPane";

function loadDual(): boolean {
  try {
    return localStorage.getItem(DUAL_KEY) === "1";
  } catch {
    return false;
  }
}

/** Second (right) editor pane. Off by default: a single editor is the normal view. */
export const dualPane = signal<boolean>(loadDual());

export function setDualPane(on: boolean): void {
  dualPane.value = on;
  if (!on) setActive("left"); // new/opened notes must go to the pane that is still visible
  try {
    localStorage.setItem(DUAL_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

export function cycleLayout(pane: "left" | "right"): void {
  const target = pane === "left" ? leftPane : rightPane;
  const order: PaneLayout[] = ["edit", "split", "preview"];
  const idx = order.indexOf(target.value.layout);
  target.value = { ...target.value, layout: order[(idx + 1) % order.length] };
}

export function setActive(pane: "left" | "right"): void {
  leftPane.value = { ...leftPane.value, active: pane === "left" };
  rightPane.value = { ...rightPane.value, active: pane === "right" };
}

export function openNoteInActive(noteId: string): void {
  const target = leftPane.value.active || !dualPane.value ? leftPane : rightPane;
  target.value = { ...target.value, noteId };
}

/** Clear any pane that is showing `noteId` (e.g. after the note was permanently deleted). */
export function closeNote(noteId: string): void {
  if (leftPane.value.noteId === noteId) leftPane.value = { ...leftPane.value, noteId: null };
  if (rightPane.value.noteId === noteId) rightPane.value = { ...rightPane.value, noteId: null };
}

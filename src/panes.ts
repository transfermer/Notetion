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
  const target = leftPane.value.active ? leftPane : rightPane;
  target.value = { ...target.value, noteId };
}
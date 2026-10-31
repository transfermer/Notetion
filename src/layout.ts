import { signal } from "@preact/signals";

const KEY = "notetion.noteListCollapsed";

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** The notes-list column can be folded to a thin rail; the choice is remembered per browser. */
export const noteListCollapsed = signal<boolean>(load());

export function setNoteListCollapsed(collapsed: boolean): void {
  noteListCollapsed.value = collapsed;
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

import { signal } from "@preact/signals";
import { EditorPane } from "./EditorPane";
import { dualPane, leftPane, rightPane, setActive } from "../panes";

export const focusMode = signal(false);
export const typewriterMode = signal(false);

export function Workspace() {
  // Read signals directly in JSX so Preact tracks them.
  return (
    <div class="workspace">
      <div
        class={`pane-slot ${leftPane.value.active ? "active" : ""}`}
        onClick={() => setActive("left")}
      >
        <EditorPane key={leftPane.value.noteId ?? "none"} pane={leftPane.value} focusMode={focusMode.value} typewriterMode={typewriterMode.value} />
      </div>
      {dualPane.value && (
      <div
        class={`pane-slot ${rightPane.value.active ? "active" : ""}`}
        onClick={() => setActive("right")}
      >
        <EditorPane key={rightPane.value.noteId ?? "none"} pane={rightPane.value} focusMode={focusMode.value} typewriterMode={typewriterMode.value} />
      </div>
      )}
    </div>
  );
}

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";

export interface EditorOptions {
  doc: string;
  onChange?: (value: string) => void;
  readonly?: boolean;
  focus?: boolean;
  /** Center the active line vertically (typewriter mode). */
  typewriter?: boolean;
}

/**
 * Mount a CodeMirror 6 editor into the given parent element.
 * Returns a handle that exposes the current value and a destroy method.
 */
export function mountEditor(parent: HTMLElement, opts: EditorOptions) {
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches({ highlightWordAroundCursor: true }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && opts.onChange) opts.onChange(update.state.doc.toString());
    }),
  ];

  if (opts.readonly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  if (opts.typewriter) {
    extensions.push(
      EditorView.editorAttributes.of({ class: "cm-typewriter" }),
      EditorView.updateListener.of((u) => {
        const { view } = u;
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        const coords = view.coordsAtPos(line.from);
        if (!coords) return;
        const rect = view.scrollDOM.getBoundingClientRect();
        const target = coords.top - rect.top - rect.height / 2 + view.defaultLineHeight / 2;
        view.scrollDOM.scrollBy({ top: target });
      }),
    );
  }

  const state = EditorState.create({ doc: opts.doc, extensions });
  const view = new EditorView({ state, parent });
  if (opts.focus) view.focus();

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (value: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    },
    scrollToLine: (line: number) => {
      const doc = view.state.doc;
      if (line < 1 || line > doc.lines) return;
      const pos = doc.line(line).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    },
    destroy: () => view.destroy(),
  };
}

export type EditorHandle = ReturnType<typeof mountEditor>;

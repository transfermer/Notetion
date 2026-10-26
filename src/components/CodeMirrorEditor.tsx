import { useEffect, useRef } from "preact/hooks";
import { mountEditor, type EditorHandle } from "../editor";

interface Props {
  value: string;
  onChange?: (value: string) => void;
  readonly?: boolean;
  focus?: boolean;
  typewriter?: boolean;
  /** External scroll target — jump the editor to this line (1-based). */
  jumpToLine?: number | null;
}

/**
 * Preact wrapper around the CodeMirror 6 editor. The editor is mounted once
 * and reused for the lifetime of the component; value changes coming from
 * outside (e.g. loading a different note) are applied via a transaction so
 * history is preserved.
 *
 * IMPORTANT: the editor's change listener is created once at mount. It must
 * NOT close over `props` (that would freeze the first render's callbacks, so
 * later edits would call a stale `onChange`). It always reads the latest
 * callback through `onChangeRef`. Programmatic `setValue()` calls (from the
 * `value` prop) are not reported back as user edits.
 */
export function CodeMirrorEditor(props: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const lastExternalValueRef = useRef<string>("");
  const applyingExternalRef = useRef(false);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const handle = mountEditor(hostRef.current, {
      doc: props.value,
      onChange: (v) => {
        if (applyingExternalRef.current) return; // programmatic setValue, not a user edit
        lastExternalValueRef.current = v;
        onChangeRef.current?.(v);
      },
      readonly: props.readonly,
      focus: props.focus,
      typewriter: props.typewriter,
    });
    handleRef.current = handle;
    lastExternalValueRef.current = props.value;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    if (props.value !== lastExternalValueRef.current) {
      applyingExternalRef.current = true;
      try {
        handle.setValue(props.value);
      } finally {
        applyingExternalRef.current = false;
      }
      lastExternalValueRef.current = props.value;
    }
  }, [props.value]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || props.jumpToLine == null) return;
    handle.scrollToLine(props.jumpToLine);
  }, [props.jumpToLine]);

  return <div ref={hostRef} class="cm-host" />;
}

import { useMemo } from "preact/hooks";
import { renderMarkdown } from "../markdown";

interface Props {
  source: string;
  onScroll?: (ratio: number) => void;
}

export function PreviewPane(props: Props) {
  const html = useMemo(() => renderMarkdown(props.source), [props.source]);
  return (
    <div
      class="preview-pane"
      onScroll={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        const max = el.scrollHeight - el.clientHeight;
        if (max > 0) props.onScroll?.(el.scrollTop / max);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

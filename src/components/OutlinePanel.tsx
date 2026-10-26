import { useMemo } from "preact/hooks";
import { extractHeadings, type HeadingNode } from "../markdown";

interface Props {
  source: string;
  onJumpToLine: (line: number) => void;
}

export function OutlinePanel(props: Props) {
  const headings = useMemo<HeadingNode[]>(() => extractHeadings(props.source), [props.source]);

  if (headings.length === 0) {
    return <div class="outline-empty">No headings</div>;
  }

  return (
    <nav class="outline">
      {headings.map((h, i) => (
        <button
          key={`${h.line}-${i}`}
          class={`outline-item h${h.level}`}
          onClick={() => props.onJumpToLine(h.line)}
          title={`Line ${h.line}`}
        >
          {h.text || "(untitled)"}
        </button>
      ))}
    </nav>
  );
}

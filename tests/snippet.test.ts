import { test } from "node:test";
import assert from "node:assert/strict";
import { snippetToSafeHtml, escapeHtml } from "../src/snippet.ts";

/** Anything between `<` and `>` in the output must be exactly <mark> or </mark>. */
function onlyMarkTags(html: string): boolean {
  const tags = html.match(/<[^>]*>/g) ?? [];
  return tags.every((t) => t === "<mark>" || t === "</mark>");
}

test("FTS snippet: keeps <mark>, neutralises injected tags", () => {
  const raw = 'see <img src=x onerror=alert(1)> and <mark>needle</mark> <script>evil()</script>';
  const out = snippetToSafeHtml(raw);
  assert.ok(onlyMarkTags(out), out);
  assert.match(out, /<mark>needle<\/mark>/);
  assert.ok(!out.includes("<img") && !out.includes("<script"));
});

test("plain markdown snippet (no marks): all tags escaped", () => {
  const out = snippetToSafeHtml('# Title\n<svg onload=alert(1)> **bold** [x](http://a)');
  assert.ok(onlyMarkTags(out), out);
  assert.ok(!out.includes("<svg"));
  assert.match(out, /Title/);
  assert.match(out, /bold/);
});

test("pre-escaped entities in note text are NOT decoded back into markup (old bug)", () => {
  const raw = "&lt;img src=x onerror=alert(1)&gt; <mark>hit</mark>";
  const out = snippetToSafeHtml(raw);
  assert.ok(onlyMarkTags(out), out);
  assert.ok(out.includes("&amp;lt;img"), "ampersand must be escaped, not decoded");
});

test("attribute-breaking quotes are escaped", () => {
  assert.equal(escapeHtml(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;");
});

test("fake mark with attributes is not allowed", () => {
  const out = snippetToSafeHtml('<mark onmouseover="x()">a</mark>');
  assert.ok(onlyMarkTags(out), out);
});

test("empty input", () => assert.equal(snippetToSafeHtml(""), ""));

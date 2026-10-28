import { render } from "preact";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("Notetion: #app root element is missing");

function showFatal(err: unknown): void {
  console.error("Notetion fatal error:", err);
  const box = document.createElement("div");
  box.style.cssText = "color:#d64545;padding:20px;font-family:system-ui";
  const h = document.createElement("h1");
  h.textContent = "Notetion failed to start";
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  box.append(h, pre);
  root!.replaceChildren(box);
}

// Dynamic import so errors thrown while LOADING modules (not just while rendering) are shown
// instead of leaving a blank page.
import("./app")
  .then(({ App }) => {
    try {
      render(<App />, root);
    } catch (err) {
      showFatal(err);
    }
  })
  .catch(showFatal);

window.addEventListener("unhandledrejection", (e) => console.error("Unhandled rejection:", e.reason));

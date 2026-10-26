import { render } from "preact";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("Notetion: #app root element is missing");
try {
  render(<App />, root);
} catch (err) {
  console.error("Notetion render error:", err);
  root.innerHTML = `<div style="color:red;padding:20px"><h1>Render Error</h1><pre>${String(err)}</pre></div>`;
}

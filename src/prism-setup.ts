// Prism language components (prism-jsx, prism-typescript, …) reference a GLOBAL `Prism`.
// Under ESM/Vite that global does not exist, so loading them threw "Prism is not defined"
// at module-evaluation time — before any render — leaving a blank page with no error UI.
// This module must be imported BEFORE any `prismjs/components/*` import.
import Prism from "prismjs";

(globalThis as unknown as { Prism: typeof Prism }).Prism = Prism;
export default Prism;

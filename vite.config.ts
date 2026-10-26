import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [preact(), cloudflare({ viteEnvironment: { name: "worker" } })],
  environments: {
    worker: {
      build: {
        sourcemap: true,
      },
    },
  },
  build: {
    target: "es2022",
  },
  server: {
    port: 5173,
  },
});

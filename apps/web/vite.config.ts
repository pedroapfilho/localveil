import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const crossOriginIsolation = (): Plugin => ({
  configureServer(server) {
    server.middlewares.use((_request, response, next) => {
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
  name: "cross-origin-isolation",
});

const ortWasm = (): Plugin => ({
  apply: "build",
  async buildStart() {
    const require = createRequire(import.meta.url);
    const binary = require.resolve("onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm");

    this.emitFile({
      fileName: "assets/ort-wasm-simd-threaded.jsep.wasm",
      source: await readFile(binary),
      type: "asset",
    });
  },
  name: "ort-wasm",
});

export default defineConfig({
  optimizeDeps: { exclude: ["@huggingface/transformers", "onnxruntime-web", "pdfjs-dist"] },
  plugins: [react(), tailwindcss(), crossOriginIsolation(), ortWasm()],
  server: { allowedHosts: [".localhost"] },

  worker: { format: "es" },
});

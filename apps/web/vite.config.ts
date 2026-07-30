import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

// ONNX Runtime only reaches for SharedArrayBuffer, and so multithreaded wasm,
// when the page is cross-origin isolated. Production sends the same pair of
// headers from vercel.json.
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

// ONNX Runtime fetches its wasm binary from beside the module that loads it: the
// package's dist directory in dev, /assets/ beside the worker chunk after a build.
// So the binary is emitted there under the exact name the loader asks for. Pointing
// `env.wasm.wasmPaths` at a hashed asset instead was measured to break the WebGPU
// provider (a wrong loader module in one form, a hang in the other).
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
  // All three ship their own wasm or worker and are loaded from inside a worker,
  // where a pre-bundled copy is served from a path that worker cannot fetch.
  // onnxruntime-web is imported both directly and through transformers.js, and
  // pre-bundling one of the two would split them into two runtimes with two
  // environments. Tesseract is deliberately not in this list: it is CommonJS, so
  // it needs the conversion that pre-bundling does.
  optimizeDeps: { exclude: ["@huggingface/transformers", "onnxruntime-web", "pdfjs-dist"] },
  plugins: [react(), tailwindcss(), crossOriginIsolation(), ortWasm()],
  server: { allowedHosts: [".localhost"] },
  // An iife worker cannot be split, so pdf.js and Tesseract would be inlined into
  // it and downloaded by everyone who only ever redacts a text file. As a module,
  // the redactors' dynamic imports stay separate chunks that load on demand.
  worker: { format: "es" },
});

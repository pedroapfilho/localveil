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

export default defineConfig({
  // Both ship their own wasm or worker and are loaded from inside a worker, where a
  // pre-bundled copy is served from a path that worker cannot fetch. Tesseract is
  // deliberately not in this list: it is CommonJS, so it needs the conversion that
  // pre-bundling does.
  optimizeDeps: { exclude: ["@huggingface/transformers", "pdfjs-dist"] },
  plugins: [react(), tailwindcss(), crossOriginIsolation()],
  server: { allowedHosts: [".localhost"] },
  // An iife worker cannot be split, so pdf.js and Tesseract would be inlined into
  // it and downloaded by everyone who only ever redacts a text file. As a module,
  // the redactors' dynamic imports stay separate chunks that load on demand.
  worker: { format: "es" },
});

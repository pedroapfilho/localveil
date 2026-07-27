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
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  plugins: [react(), tailwindcss(), crossOriginIsolation()],
  server: { allowedHosts: [".localhost"] },
});

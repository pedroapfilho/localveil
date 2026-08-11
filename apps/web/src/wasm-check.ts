import { createDetector, MODEL_ID } from "@repo/pii-detect";

const CACHE_KEY = "transformers-cache";
const MODEL_REVISION = "2e0397a7e8a250d76c37122232b3cbde42c8d629";

const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/onnx/model_q4.onnx`;

const TEXT = "Fatura para Mariana Duarte Rocha, CPF 529.982.247-25, em 14/03/2024.";

const out = document.querySelector("#out");

const say = (line: string) => {
  if (out !== null) {
    out.textContent = `${out.textContent ?? ""}${line}\n`;
  }
};

const seed = async () => {
  const cache = await caches.open(CACHE_KEY);
  const already = await cache.match(MODEL_URL);

  if (already !== undefined) {
    say("candidate already seeded in CacheStorage");

    return;
  }

  const started = performance.now();
  const response = await fetch("/candidate.onnx");
  const bytes = await response.arrayBuffer();

  say(
    `fetched ${(bytes.byteLength / 1024 / 1024).toFixed(0)} MB in ${(performance.now() - started).toFixed(0)} ms`,
  );

  await cache.put(MODEL_URL, new Response(bytes));
  say("seeded the candidate under the pinned model URL");
};

const run = async () => {
  if (new URLSearchParams(location.search).get("device") === "wasm") {
    Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
    say("forced the wasm path by hiding navigator.gpu");
  }

  say(`webgpu adapter: ${String(navigator.gpu !== undefined)}`);

  await seed();

  const detect = await createDetector({
    minScore: 0.05,
    onProgress: (fraction, stage) => {
      if (stage !== "model.downloading") {
        say(`stage ${stage}`);
      }
    },
  });

  say("session created");

  const spans = await detect(TEXT);

  say(`spans above 0.05: ${String(spans.length)}`);

  for (const span of spans.toSorted((a, b) => b.score - a.score).slice(0, 8)) {
    say(`  ${span.score.toFixed(4)}  ${span.label}  ${TEXT.slice(span.start, span.end)}`);
  }

  say("DONE");
};

try {
  await run();
} catch (error) {
  say(`FAILED ${String(error)}`);
}

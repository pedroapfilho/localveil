import { createDetector, DEFAULT_MODEL_ID, isModelId, modelById } from "@repo/pii-detect";
import { tokenizerUrls, weightsUrl } from "@repo/pii-detect/models";

const CACHE_KEY = "transformers-cache";

const asked = new URLSearchParams(location.search).get("model") ?? DEFAULT_MODEL_ID;
const MODEL = isModelId(asked) ? asked : DEFAULT_MODEL_ID;

const MODEL_URL = weightsUrl(modelById(MODEL));

const [TOKENIZER_URL] = tokenizerUrls(modelById(MODEL));

const TEXT = "Fatura para Mariana Duarte Rocha, CPF 529.982.247-25, em 14/03/2024.";

const LONG = `${TEXT} `.repeat(120);

const out = document.querySelector("#out");

const say = (line: string) => {
  if (out !== null) {
    out.textContent = `${out.textContent ?? ""}${line}\n`;
  }
};

const seedFrom = async (local: string, url: string, label: string) => {
  const cache = await caches.open(CACHE_KEY);
  const already = await cache.match(url);

  if (already !== undefined) {
    say(`${label} already seeded`);

    return;
  }

  const response = await fetch(local);
  const type = response.headers.get("content-type") ?? "";

  if (!response.ok || type.includes("text/html")) {
    say(`no ${local} to seed, so ${label} comes from Hugging Face`);

    return;
  }

  const started = performance.now();
  const bytes = await response.arrayBuffer();

  say(
    `${label} ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB in ${(performance.now() - started).toFixed(0)} ms`,
  );

  await cache.put(url, new Response(bytes));
};

const seed = async () => {
  await seedFrom("/candidate-tokenizer.json", TOKENIZER_URL, "tokenizer");
  await seedFrom("/candidate.onnx", MODEL_URL, "weights");
};

const run = async () => {
  if (new URLSearchParams(location.search).get("reset") === "1") {
    await caches.delete(CACHE_KEY);
    say("cleared CacheStorage, so nothing stale is reused");
  }

  if (new URLSearchParams(location.search).get("device") === "wasm") {
    Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
    say("forced the wasm path by hiding navigator.gpu");
  }

  say(`webgpu adapter: ${String(navigator.gpu !== undefined)}`);

  await seed();

  const batchSize = Number(new URLSearchParams(location.search).get("batch") ?? "1");

  say(`model ${MODEL}`);

  const detect = await createDetector({
    batchSize,
    minScore: 0.05,
    model: MODEL,
    onProgress: (fraction, stage) => {
      if (stage !== "model.downloading") {
        say(`stage ${stage}`);
      }
    },
  });

  say(`session created, batchSize ${String(batchSize)}`);

  if (new URLSearchParams(location.search).get("bench") === "1") {
    await detect(TEXT);

    const started = performance.now();

    await detect(LONG);
    await detect(LONG);

    say(
      `bench: ${((performance.now() - started) / 2).toFixed(0)} ms per pass over ${String(LONG.length)} chars`,
    );
  }

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

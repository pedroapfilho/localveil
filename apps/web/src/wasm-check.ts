import { createDetector, DEFAULT_MODEL_ID, isModelId, readModelFiles } from "@repo/pii-detect";

const asked = new URLSearchParams(location.search).get("model") ?? DEFAULT_MODEL_ID;
const MODEL = isModelId(asked) ? asked : DEFAULT_MODEL_ID;

const TEXT = "Fatura para Mariana Duarte Rocha, CPF 529.982.247-25, em 14/03/2024.";

const LONG = `${TEXT} `.repeat(120);

const out = document.querySelector("#out");

const hasWebGpu = ({ gpu }: { gpu?: GPU }) => gpu !== undefined;

const say = (line: string) => {
  if (out !== null) {
    out.textContent = `${out.textContent}${line}\n`;
  }
};

const candidateFiles = async (directory: string) =>
  readModelFiles(async (name) => {
    const response = await fetch(`${directory.replace(/\/$/v, "")}/${name}`);

    if (!response.ok || response.headers.get("content-type")?.includes("text/html") === true) {
      throw new Error(`Could not load candidate ${name}: ${String(response.status)}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  });

const run = async () => {
  if (new URLSearchParams(location.search).get("device") === "wasm") {
    Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
    say("forced the wasm path by hiding navigator.gpu");
  }

  say(`webgpu adapter: ${String(hasWebGpu(navigator))}`);

  const candidate = new URLSearchParams(location.search).get("candidate");
  const files = candidate === null ? undefined : await candidateFiles(candidate);

  const batchSize = Number(new URLSearchParams(location.search).get("batch") ?? "1");

  say(`model ${MODEL}`);

  const detect = await createDetector({
    batchSize,
    files,
    minScore: 0.05,
    model: MODEL,
    onLoad: (event) => {
      if (event.kind !== "loading") {
        say(`model ${event.kind}`);
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

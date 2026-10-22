/* oxlint-disable anti-slop/no-module-mocking -- the runtime seam substitutes inference; catalog access must fail if a supplied candidate ever reaches it */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openModel } from "#model-store";
import { createModelRunner, pickDevice } from "#ort";

import { DEFAULT_MODEL_ID, modelById, tokenizerUrls, weightsUrl } from "./catalog";
import { createDetector } from "./detector";
import { readModelFiles } from "./model-files";
import { fakeModelRun, MODEL_FILES } from "./model-run-fixture";
import { createBrowserModelStore } from "./model-store-browser";
import { memoryCaches, memoryChunks } from "./model-store-fixture";
import type * as NodeStore from "./model-store-node";
import { createNodeModelStore } from "./model-store-node";

vi.mock("#model-store", async (importOriginal) => ({
  ...(await importOriginal<typeof NodeStore>()),
  openModel: vi.fn(),
}));

vi.mock("#ort", () => ({ createModelRunner: vi.fn(), pickDevice: vi.fn() }));

const MODEL = modelById(DEFAULT_MODEL_ID);
const encoder = new TextEncoder();

const candidate = new Map([
  ["tokenizer.json", encoder.encode(JSON.stringify(MODEL_FILES.tokenizer))],
  ["tokenizer_config.json", encoder.encode(JSON.stringify(MODEL_FILES.tokenizerConfig))],
  ["model.onnx", new Uint8Array([9, 8, 7])],
]);

const ignore = () => undefined;

const catalogBody = (url: string) => {
  if (url === tokenizerUrls(MODEL)[0]) {
    return candidate.get("tokenizer.json");
  }

  return url.endsWith(".json") ? encoder.encode("{}") : new Uint8Array([1, 2, 3]);
};

let directory = "";
let candidateDirectory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "localveil-catalog-isolation-"));
  candidateDirectory = await mkdtemp(path.join(tmpdir(), "localveil-candidate-"));

  await Promise.all(
    [...candidate].map(([name, bytes]) => writeFile(path.join(candidateDirectory, name), bytes)),
  );
  vi.mocked(openModel).mockReset().mockRejectedValue(new Error("candidate accessed catalog"));
  vi.mocked(pickDevice).mockReset().mockResolvedValue("wasm");
  vi.mocked(createModelRunner)
    .mockReset()
    .mockResolvedValue(fakeModelRun(MODEL, () => [{ end: 1, prompt: "person", start: 0 }]).run);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    [directory, candidateDirectory].map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

const nodeSnapshot = async () => {
  const names = await readdir(directory);

  return Promise.all(
    names.toSorted().map(async (name) => [name, await readFile(path.join(directory, name))]),
  );
};

const prepare = async () => {
  vi.stubGlobal("fetch", (url: string) => Promise.resolve(new Response(catalogBody(url))));
  const caches = memoryCaches();
  const chunks = memoryChunks();
  const node = createNodeModelStore(directory);
  const browser = createBrowserModelStore(chunks);

  await node.downloadModel(MODEL, ignore);
  caches.keep([tokenizerUrls(MODEL)[0]], catalogBody(tokenizerUrls(MODEL)[0]));
  caches.keep([tokenizerUrls(MODEL)[1]], encoder.encode("{}"));
  caches.keep([weightsUrl(MODEL)], new Uint8Array([1, 2, 3]));

  const snapshot = async () => ({
    browser: await Promise.all(
      [...caches.entries].map(async ([url, response]) => [
        url,
        new Uint8Array(await response.clone().arrayBuffer()),
      ]),
    ),
    chunks: await chunks.listUrls(),
    node: await nodeSnapshot(),
  });

  const before = await snapshot();

  const unchanged = async () => {
    expect(openModel).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
    await expect(node.openModel(MODEL, ignore)).resolves.toMatchObject({
      weights: new Uint8Array([1, 2, 3]),
    });
    await expect(browser.openModel(MODEL, ignore)).resolves.toMatchObject({
      weights: new Uint8Array([1, 2, 3]),
    });
  };

  return unchanged;
};

describe.each(["node", "browser"] as const)("%s candidate isolation", (adapter) => {
  const load = () =>
    readModelFiles(
      adapter === "node"
        ? (name) => readFile(path.join(candidateDirectory, name))
        : async (name) => {
            const response = new Response(candidate.get(name));

            return new Uint8Array(await response.arrayBuffer());
          },
    );

  it.each(["wasm", "webgpu"] as const)(
    "detects the same candidate spans on %s without touching catalog bytes",
    async (device) => {
      const unchanged = await prepare();
      vi.mocked(pickDevice).mockResolvedValue(device);
      const files = await load();
      const detect = await createDetector({ files });

      expect(files.tokenizer).toEqual(MODEL_FILES.tokenizer);
      expect(files.tokenizerConfig).toEqual(MODEL_FILES.tokenizerConfig);
      expect(await detect("Ana Lima signed")).toEqual([
        { end: 8, label: "private_person", score: 1, start: 0 },
      ]);
      expect(createModelRunner).toHaveBeenCalledWith(files.weights, device);
      await unchanged();
    },
  );

  it("leaves catalog bytes unchanged after a session failure", async () => {
    const unchanged = await prepare();
    vi.mocked(createModelRunner).mockRejectedValue(new Error("invalid candidate graph"));

    await expect(createDetector({ files: await load() })).rejects.toThrow(
      "invalid candidate graph",
    );
    await unchanged();
  });

  it("leaves catalog bytes unchanged when stopped during session creation", async () => {
    const unchanged = await prepare();
    const controller = new AbortController();
    vi.mocked(createModelRunner).mockImplementation(() => {
      controller.abort();

      return Promise.resolve(fakeModelRun(MODEL, () => []).run);
    });

    await expect(
      createDetector({ files: await load(), signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await unchanged();
  });

  it("leaves catalog bytes unchanged when candidate file loading is interrupted", async () => {
    const unchanged = await prepare();

    await expect(
      readModelFiles(() => Promise.reject(new DOMException("Stopped", "AbortError"))),
    ).rejects.toMatchObject({ name: "AbortError" });
    await unchanged();
  });
});

describe("readModelFiles", () => {
  it.each(["null", "42", '"tokenizer"'])("rejects non-object tokenizer data %s", async (json) => {
    await expect(readModelFiles(() => Promise.resolve(encoder.encode(json)))).rejects.toThrow(
      "not a JSON object",
    );
  });

  it("rejects a missing config instead of using a catalog file", async () => {
    await expect(
      readModelFiles((name) =>
        name === "tokenizer_config.json"
          ? Promise.reject(new Error("missing config"))
          : Promise.resolve(candidate.get(name) ?? new Uint8Array()),
      ),
    ).rejects.toThrow("missing config");
  });
});

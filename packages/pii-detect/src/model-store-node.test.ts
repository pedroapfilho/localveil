/* oxlint-disable anti-slop/no-module-mocking -- only the home directory is substituted; downloads exercise the real disk cache in a scratch folder */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type * as Os from "node:os";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { modelById, tokenizerUrls, weightsUrl } from "./catalog";
import { cachePathFor, fetchKept, MODEL_CACHE_DIR } from "./disk-cache";
import { downloadModel, inspectModel, removeModel } from "./model-store-node";

const scratch = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof Os>();
  const { mkdtemp: makeTemp } = await import("node:fs/promises");

  scratch.directory = await makeTemp(`${original.tmpdir()}/localveil-models-`);

  return { ...original, homedir: () => scratch.directory };
});

const MODEL = modelById("gliner-pii-base");
const EVERYTHING = [...tokenizerUrls(MODEL), weightsUrl(MODEL)];
const BODY = new Uint8Array(12);

const keep = (urls: Array<string>) =>
  Promise.all(urls.map((url) => writeFile(cachePathFor(url), BODY)));

beforeEach(async () => {
  await mkdir(MODEL_CACHE_DIR, { recursive: true });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => Promise.resolve(new Response(BODY))),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(MODEL_CACHE_DIR, { force: true, recursive: true });
});

afterAll(async () => {
  await rm(scratch.directory, { force: true, recursive: true });
});

// Storage can become unavailable after the network request began, even if the initial stat succeeded.
const refuseSaving = () => {
  vi.mocked(fetch).mockImplementation(async () => {
    await rm(MODEL_CACHE_DIR, { force: true, recursive: true });
    await writeFile(MODEL_CACHE_DIR, "blocked");

    return new Response(BODY);
  });
};

describe("the CLI's model store", () => {
  it("reports a model ready once its weights and tokenizer are all on disk", async () => {
    await keep(EVERYTHING);

    await expect(inspectModel(MODEL)).resolves.toEqual({
      bytes: 12,
      path: cachePathFor(weightsUrl(MODEL)),
      state: "ready",
    });
  });

  it("does not call weights without their tokenizer ready, since they cannot load offline", async () => {
    await keep([weightsUrl(MODEL)]);

    await expect(inspectModel(MODEL)).resolves.toMatchObject({ state: "partial" });
  });

  it("reports a model with no weights on disk as absent", async () => {
    await keep(tokenizerUrls(MODEL));

    await expect(inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
  });

  it("persists every file before reporting a download complete", async () => {
    await downloadModel(MODEL, () => undefined);

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(EVERYTHING);
    await expect(inspectModel(MODEL)).resolves.toMatchObject({ state: "ready" });
    for (const url of EVERYTHING) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
      const stored = await readFile(cachePathFor(url));

      expect(new Uint8Array(stored)).toEqual(BODY);
    }
    const names = await readdir(MODEL_CACHE_DIR);

    expect(names.some((file) => file.includes(".part-"))).toBe(false);
  });

  it("fetches only what is missing and reports already kept weights complete", async () => {
    await keep([EVERYTHING[0], weightsUrl(MODEL)]);
    const reported: Array<number> = [];

    await downloadModel(MODEL, (fraction) => {
      reported.push(fraction);
    });

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([EVERYTHING[1]]);
    expect(reported).toEqual([1]);
  });

  it("rejects explicit downloads when saving the weights fails", async () => {
    await keep(tokenizerUrls(MODEL));
    refuseSaving();

    await expect(downloadModel(MODEL, () => undefined)).rejects.toThrow();
  });

  it("still lets inference use fetched bytes if they cannot be saved", async () => {
    refuseSaving();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(fetchKept(weightsUrl(MODEL), () => undefined)).resolves.toEqual(BODY);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("deletes every file of a model, and does not mind one that was never there", async () => {
    await keep(EVERYTHING);
    await removeModel(MODEL);
    await removeModel(MODEL);

    await expect(inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
  });
});

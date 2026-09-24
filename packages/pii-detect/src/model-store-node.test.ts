/* oxlint-disable anti-slop/no-module-mocking -- the disk cache lives under the real home directory; the module seam points it at a scratch folder */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { modelById } from "./catalog";
import type * as DiskCache from "./disk-cache";
import { fetchKept } from "./disk-cache";
import { downloadModel, inspectModel, removeModel } from "./model-store-node";

const scratch = vi.hoisted(() => ({ directory: "" }));

vi.mock("./disk-cache", async (importOriginal) => {
  const original = await importOriginal<typeof DiskCache>();

  return {
    ...original,
    cachePathFor: (url: string) => `${scratch.directory}/${url.split("/").at(-1) ?? "weights"}`,
    fetchKept: vi.fn(() => Promise.resolve(new Uint8Array())),
  };
});

const MODEL = modelById("gliner-pii-base");

const keep = async (files: Array<string>) => {
  await Promise.all(
    files.map((file) => writeFile(path.join(scratch.directory, file), new Uint8Array(12))),
  );
};

const EVERYTHING = ["tokenizer.json", "tokenizer_config.json", MODEL.file];

beforeEach(async () => {
  scratch.directory = await mkdtemp(path.join(tmpdir(), "localveil-models-"));
  vi.mocked(fetchKept).mockClear();
});

afterEach(async () => {
  await rm(scratch.directory, { force: true, recursive: true });
});

describe("the CLI's model store", () => {
  it("reports a model ready once its weights and tokenizer are all on disk", async () => {
    await keep(EVERYTHING);

    await expect(inspectModel(MODEL)).resolves.toEqual({
      bytes: 12,
      path: path.join(scratch.directory, MODEL.file),
      state: "ready",
    });
  });

  it("does not call weights without their tokenizer ready, since they cannot load offline", async () => {
    await keep([MODEL.file]);

    await expect(inspectModel(MODEL)).resolves.toMatchObject({ state: "partial" });
  });

  it("reports a model with no weights on disk as absent", async () => {
    await keep(["tokenizer.json"]);

    await expect(inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
  });

  it("downloads the tokenizer before the weights", async () => {
    await downloadModel(MODEL, () => undefined);

    expect(vi.mocked(fetchKept).mock.calls.map(([url]) => url.split("/").at(-1))).toEqual(
      EVERYTHING,
    );
  });

  it("fetches only what is missing, and does not read kept weights back into memory", async () => {
    await keep(["tokenizer.json", MODEL.file]);

    const reported: Array<number> = [];

    await downloadModel(MODEL, (fraction) => {
      reported.push(fraction);
    });

    expect(vi.mocked(fetchKept).mock.calls.map(([url]) => url.split("/").at(-1))).toEqual([
      "tokenizer_config.json",
    ]);
    expect(reported).toEqual([1]);
  });

  it("deletes every file of a model, and does not mind one that was never there", async () => {
    await keep(EVERYTHING);
    await removeModel(MODEL);
    await removeModel(MODEL);

    await expect(inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
  });
});

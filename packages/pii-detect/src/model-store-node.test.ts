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

const keep = async () => {
  const file = path.join(scratch.directory, MODEL.file);

  await writeFile(file, new Uint8Array(12));

  return file;
};

beforeEach(async () => {
  scratch.directory = await mkdtemp(path.join(tmpdir(), "localveil-models-"));
  vi.mocked(fetchKept).mockClear();
});

afterEach(async () => {
  await rm(scratch.directory, { force: true, recursive: true });
});

describe("the CLI's model store", () => {
  it("reports a kept file as ready, with where it lives", async () => {
    const file = await keep();

    await expect(inspectModel(MODEL)).resolves.toEqual({ bytes: 12, path: file, state: "ready" });
  });

  it("reports a missing file as absent", async () => {
    await expect(inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
  });

  it("downloads a model that is not kept", async () => {
    await downloadModel(MODEL, () => undefined);

    expect(fetchKept).toHaveBeenCalledOnce();
  });

  it("does not read a kept model back into memory just to download it again", async () => {
    await keep();

    const reported: Array<number> = [];

    await downloadModel(MODEL, (fraction) => {
      reported.push(fraction);
    });

    expect(fetchKept).not.toHaveBeenCalled();
    expect(reported).toEqual([1]);
  });

  it("deletes a kept model, and does not mind one that was never there", async () => {
    await keep();
    await removeModel(MODEL);
    await removeModel(MODEL);

    await expect(inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
  });
});

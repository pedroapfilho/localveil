import type { ModelSpec, ModelStatus, ModelStore } from "@repo/pii-detect/models";
import { describe, expect, it } from "vitest";

import { runModelsCommand } from "./models-command";

const capture = (isTTY = false) => {
  let text = "";

  return {
    isTTY,
    read: () => text,
    write: (chunk: string) => {
      text += chunk;
    },
  };
};

const fakeStore = (statuses: Record<string, ModelStatus> = {}) => {
  const calls: Array<string> = [];

  const store: ModelStore = {
    downloadModel: (model: ModelSpec, onProgress: (fraction: number) => void) => {
      calls.push(`download ${model.id}`);
      onProgress(0.5);
      onProgress(1);

      return Promise.resolve();
    },
    inspectModel: (model: ModelSpec) => Promise.resolve(statuses[model.id] ?? { state: "absent" }),
    removeModel: (model: ModelSpec) => {
      calls.push(`remove ${model.id}`);

      return Promise.resolve();
    },
  };

  return { calls, store };
};

const run = async (args: Array<string>, store: ModelStore, isTTY = false) => {
  const out = capture();
  const err = capture(isTTY);
  const code = await runModelsCommand(args, { err, out, store });

  return { code, err: err.read(), out: out.read() };
};

describe("localveil models", () => {
  it("lists every model with its size and whether it is downloaded", async () => {
    const { store } = fakeStore({
      "gliner-multi-pii": { bytes: 893_933_650, path: "/x", state: "ready" },
    });
    const { code, out } = await run([], store);

    expect(code).toBe(0);
    expect(out).toMatch(
      /gliner-multi-pii \(default\)\s+GLiNER multi PII\s+894 MB\s+en es pt\s+downloaded/v,
    );
    expect(out).toMatch(/gliner-pii-base\s+GLiNER PII base\s+197 MB\s+en\s+not downloaded/v);
    expect(out).toMatch(/Kept in .*localveil\/models/v);
  });

  it("downloads a model ahead of time, showing progress on a terminal", async () => {
    const { calls, store } = fakeStore();
    const { code, err, out } = await run(["download", "gliner-pii-base"], store, true);

    expect(code).toBe(0);
    expect(calls).toEqual(["download gliner-pii-base"]);
    expect(err).toContain("\rDownloading GLiNER PII base 50%");
    expect(out).toBe("GLiNER PII base is downloaded (197 MB).\n");
  });

  it("removes a downloaded model and says how much it freed", async () => {
    const { calls, store } = fakeStore({
      "gliner-pii-base": { bytes: 196_757_174, state: "ready" },
    });
    const { code, out } = await run(["remove", "gliner-pii-base"], store);

    expect(code).toBe(0);
    expect(calls).toEqual(["remove gliner-pii-base"]);
    expect(out).toBe("Removed GLiNER PII base, freeing 197 MB.\n");
  });

  it("says so when there was nothing to remove", async () => {
    const { store } = fakeStore();
    const { out } = await run(["remove", "gliner-pii-base"], store);

    expect(out).toBe("GLiNER PII base was not downloaded.\n");
  });

  it("refuses a model it does not know and names the ones it does", async () => {
    const { calls, store } = fakeStore();
    const { code, err } = await run(["download", "gpt"], store);

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toContain(
      "There is no model called gpt. Choose one of gliner-multi-pii, gliner-pii-base.",
    );
  });

  it("prints its usage for an action it does not have", async () => {
    const { store } = fakeStore();
    const { code, err } = await run(["rename", "gliner-pii-base"], store);

    expect(code).toBe(1);
    expect(err).toContain("localveil models download <id>");
  });
});

import { createHash } from "node:crypto";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const MODEL_ID = "onnx-community/gliner_multi_pii-v1";
const MODEL_REVISION = "2e0397a7e8a250d76c37122232b3cbde42c8d629";
const MODEL_FILE = "model_q4.onnx";

const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/onnx/${MODEL_FILE}`;

const CACHE = path.join(homedir(), ".cache", "localveil", "models");

const digest = createHash("sha256").update(MODEL_URL).digest("hex").slice(0, 16);

const slot = path.join(CACHE, `${digest}-${MODEL_FILE}`);
const kept = `${slot}.original`;

const note = (message: string) => {
  process.stderr.write(`${message}\n`);
};

const exists = async (file: string) => {
  try {
    await stat(file);

    return true;
  } catch {
    return false;
  }
};

const restore = async () => {
  if (!(await exists(kept))) {
    note("nothing to restore");

    return;
  }

  await rm(slot, { force: true });
  await rename(kept, slot);
  note(`restored ${slot}`);
};

const swap = async (candidate: string) => {
  await mkdir(CACHE, { recursive: true });

  if ((await exists(slot)) && !(await exists(kept))) {
    await rename(slot, kept);
    note(`kept the shipped weights at ${kept}`);
  }

  await copyFile(candidate, slot);

  const { size } = await stat(slot);

  note(`swapped in ${candidate} (${(size / 1024 / 1024).toFixed(0)} MB)`);
  note("run: pnpm --filter @repo/eval start");
  note("then: pnpm --filter @repo/eval swap --restore");
};

const candidate = process.argv[2];

if (candidate === undefined) {
  note("usage: swap-model <candidate.onnx> | --restore");
  process.exitCode = 1;
} else if (candidate === "--restore") {
  await restore();
} else {
  await swap(candidate);
}

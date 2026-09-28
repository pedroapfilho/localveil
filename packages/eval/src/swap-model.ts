import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { DEFAULT_MODEL_ID, isModelId, modelById, MODELS } from "@repo/pii-detect";
import { weightsPath } from "@repo/pii-detect/node";

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

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { model: { type: "string" }, restore: { type: "boolean" } },
});

const model = values.model ?? DEFAULT_MODEL_ID;

if (!isModelId(model)) {
  throw new RangeError(
    `--model takes one of ${MODELS.map((entry) => entry.id).join(", ")}, not ${model}`,
  );
}

// The CLI's own cache slot for this model, so a candidate copied there is what the detector loads.
const slot = weightsPath(modelById(model));
const kept = `${slot}.original`;

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
  await mkdir(path.dirname(slot), { recursive: true });

  if ((await exists(slot)) && !(await exists(kept))) {
    await rename(slot, kept);
    note(`kept the shipped weights at ${kept}`);
  }

  await copyFile(candidate, slot);

  const { size } = await stat(slot);

  note(`swapped in ${candidate} (${(size / 1024 / 1024).toFixed(0)} MB) for ${model}`);
  note(`run: pnpm --filter @repo/eval start --model ${model}`);
  note(`then: pnpm --filter @repo/eval swap --model ${model} --restore`);
};

const candidate = positionals.at(0);

if (values.restore === true) {
  await restore();
} else if (candidate === undefined) {
  note("usage: swap-model [--model <id>] <candidate.onnx> | --restore");
  process.exitCode = 1;
} else {
  await swap(candidate);
}

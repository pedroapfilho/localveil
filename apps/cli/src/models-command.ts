import { homedir } from "node:os";

import type { ModelId, ModelSpec, ModelStatus, ModelStore } from "@repo/pii-detect/models";
import {
  DEFAULT_MODEL_ID,
  downloadModel,
  inspectModel,
  isModelId,
  modelById,
  MODELS,
  removeModel,
} from "@repo/pii-detect/models";
import { MODEL_CACHE_DIR } from "@repo/pii-detect/node";

type Output = { isTTY?: boolean; write: (text: string) => void };

type ModelsIo = { err: Output; out: Output; store?: ModelStore };

type Listed = { model: ModelSpec; status: ModelStatus };

const USAGE = `Usage:
  localveil models                  list the detection models and which are downloaded
  localveil models download <id>    download a model now rather than on the first run
  localveil models remove <id>      delete a downloaded model
  localveil --model <id> [paths]    redact with a model other than the default
`;

const NODE_STORE: ModelStore = { downloadModel, inspectModel, removeModel };

const MEGABYTE = 1_000_000;

const formatSize = (bytes: number) => `${String(Math.round(bytes / MEGABYTE))} MB`;

const tidyPath = (path: string) => {
  const home = homedir();

  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

const describeStatus = (status: ModelStatus) => {
  if (status.state === "ready") {
    return "downloaded";
  }

  return status.state === "partial"
    ? `${String(Math.floor((status.loaded / status.total) * 100))}% downloaded`
    : "not downloaded";
};

const formatModelTable = (rows: ReadonlyArray<Listed>) => {
  const cells = rows.map(({ model, status }) => [
    model.id === DEFAULT_MODEL_ID ? `${model.id} (default)` : model.id,
    model.name,
    formatSize(status.state === "ready" ? status.bytes : model.bytes),
    model.languages.join(" "),
    describeStatus(status),
  ]);
  const table = [["MODEL", "NAME", "SIZE", "LANGUAGES", "STATUS"], ...cells];
  const widths = table[0].map((_cell, column) =>
    Math.max(...table.map((row) => row[column].length)),
  );

  return table.map((row) =>
    row
      .map((cell, at) => cell.padEnd(widths[at]))
      .join("  ")
      .trimEnd(),
  );
};

const idFrom = (value: string | undefined, io: ModelsIo): ModelId | undefined => {
  if (value !== undefined && isModelId(value)) {
    return value;
  }

  io.err.write(
    `${value === undefined ? "Name a model" : `There is no model called ${value}`}. Choose one of ${MODELS.map((model) => model.id).join(", ")}.\n`,
  );

  return undefined;
};

const list = async ({ out, store = NODE_STORE }: ModelsIo) => {
  const rows = await Promise.all(
    MODELS.map(async (model) => ({ model, status: await store.inspectModel(model) })),
  );

  out.write(`${formatModelTable(rows).join("\n")}\n\nKept in ${tidyPath(MODEL_CACHE_DIR)}\n`);

  return 0;
};

const download = async (id: ModelId, io: ModelsIo) => {
  const { err, out, store = NODE_STORE } = io;
  const model = modelById(id);
  let shown = -1;

  await store.downloadModel(model, (fraction) => {
    const percent = Math.floor(fraction * 100);

    if (err.isTTY === true && percent !== shown) {
      shown = percent;
      err.write(`\rDownloading ${model.name} ${String(percent)}%`);
    }
  });

  if (shown >= 0) {
    err.write("\n");
  }

  out.write(`${model.name} is downloaded (${formatSize(model.bytes)}).\n`);

  return 0;
};

const remove = async (id: ModelId, io: ModelsIo) => {
  const { out, store = NODE_STORE } = io;
  const model = modelById(id);
  const before = await store.inspectModel(model);

  await store.removeModel(model);
  out.write(
    before.state === "absent"
      ? `${model.name} was not downloaded.\n`
      : `Removed ${model.name}, freeing ${formatSize(before.state === "ready" ? before.bytes : before.loaded)}.\n`,
  );

  return 0;
};

const runModelsCommand = (args: ReadonlyArray<string>, io: ModelsIo): Promise<number> => {
  const [action, value, ...rest] = args;

  if (rest.length > 0) {
    io.err.write(USAGE);

    return Promise.resolve(1);
  }

  if (action === undefined || (action === "list" && value === undefined)) {
    return list(io);
  }

  if (action !== "download" && action !== "remove") {
    io.err.write(USAGE);

    return Promise.resolve(1);
  }

  const id = idFrom(value, io);

  if (id === undefined) {
    return Promise.resolve(1);
  }

  return action === "download" ? download(id, io) : remove(id, io);
};

export { runModelsCommand };

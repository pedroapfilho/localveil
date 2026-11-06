import { warnRecoverable } from "@repo/redact-core";

import type { ModelSpec } from "./catalog";
import { MODELS, tokenizerUrls, weightsUrl } from "./catalog";
import type { ModelFiles, ModelStatus } from "./model-status";
import { settleAll } from "./settle-all";

type FileProgress = (fraction: number) => void;

type FetchFile<T> = (url: string, onProgress: FileProgress) => Promise<T>;

type Persistence = "required" | "best-effort";

const ignore = () => undefined;

const fileUrls = (model: ModelSpec) => [...tokenizerUrls(model), weightsUrl(model)];

// Two exports of one revision share its tokenizer, so removing one leaves what the other needs.
const ownedUrls = (model: ModelSpec) => {
  const shared = new Set(MODELS.flatMap((other) => (other.id === model.id ? [] : fileUrls(other))));

  return fileUrls(model).filter((url) => !shared.has(url));
};

/* Anything else a store holds is a superseded revision or an export the app stopped using, and at
   hundreds of megabytes it is not left behind. */
const CATALOGUED: ReadonlySet<string> = new Set(MODELS.flatMap(fileUrls));

/* A model without its tokenizer cannot load offline, so the two small files land, and are read,
   before the weights are fetched, and only the weights count as download progress. */
const inOrder = async <T, R>(
  model: ModelSpec,
  onProgress: FileProgress,
  fetchFile: FetchFile<T>,
  readTokenizer: (file: T, url: string) => R,
) => {
  const [tokenizerUrl, configUrl] = tokenizerUrls(model);
  const tokenizerFile = async (url: string) => readTokenizer(await fetchFile(url, ignore), url);

  const [tokenizer, tokenizerConfig] = await settleAll([
    tokenizerFile(tokenizerUrl),
    tokenizerFile(configUrl),
  ]);

  // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- the tokenizer is read before the weights are fetched
  const weights = await fetchFile(weightsUrl(model), onProgress);

  return { tokenizer, tokenizerConfig, weights };
};

const parseJson = (bytes: Uint8Array, url: string): object => {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError(`${url} is not a JSON object`);
  }

  return parsed;
};

const readModelFiles = async (
  readFile: (name: string) => Promise<Uint8Array>,
): Promise<ModelFiles> => {
  const [tokenizer, tokenizerConfig, weights] = await settleAll([
    readFile("tokenizer.json").then((bytes) => parseJson(bytes, "tokenizer.json")),
    readFile("tokenizer_config.json").then((bytes) => parseJson(bytes, "tokenizer_config.json")),
    readFile("model.onnx"),
  ]);

  return { tokenizer, tokenizerConfig, weights };
};

const warnSweepFailed = (cause: unknown) => {
  warnRecoverable("Could not clear superseded model weights", cause);
};

const downloadInOrder = async <T>(
  model: ModelSpec,
  onProgress: FileProgress,
  keepFile: FetchFile<T>,
): Promise<void> => {
  await inOrder(model, onProgress, keepFile, ignore);

  onProgress(1);
};

const keptStatus = async (
  model: ModelSpec,
  sizeOf: (url: string) => Promise<number | undefined>,
  banked: () => Promise<number>,
): Promise<ModelStatus> => {
  const urls = fileUrls(model);
  const sizes = await Promise.all(urls.map(sizeOf));
  const weights = sizes[urls.indexOf(weightsUrl(model))];

  if (weights === undefined) {
    const loaded = await banked();

    return loaded > 0 ? { loaded, state: "partial", total: model.bytes } : { state: "absent" };
  }

  return sizes.every((size) => size !== undefined)
    ? { bytes: weights, state: "ready" }
    : { loaded: weights, state: "partial", total: model.bytes };
};

const openInOrder = async (
  model: ModelSpec,
  onProgress: FileProgress,
  readFile: FetchFile<Uint8Array>,
  sweepStale: () => Promise<void>,
): Promise<ModelFiles> => {
  const files = await inOrder(model, onProgress, readFile, parseJson);

  try {
    await sweepStale();
  } catch (error) {
    warnSweepFailed(error);
  }

  return files;
};

export { CATALOGUED, downloadInOrder, keptStatus, openInOrder, ownedUrls, readModelFiles };

export type { FileProgress, Persistence };

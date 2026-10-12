import type { ModelSpec } from "./catalog";
import { MODELS, tokenizerUrls, weightsUrl } from "./catalog";
import type { ModelFiles } from "./model-status";
import { settleAll } from "./settle-all";

type FileProgress = (fraction: number) => void;

type FetchFile<T> = (url: string, onProgress: FileProgress) => Promise<T>;

type Persistence = "required" | "best-effort";

const ignore = () => undefined;

const fileUrls = (model: ModelSpec) => [...tokenizerUrls(model), weightsUrl(model)];

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

const warnSweepFailed = (cause: unknown) => {
  // oxlint-disable-next-line eslint/no-console -- a stale-weights purge failure is recoverable, so it is surfaced in the console instead of thrown
  console.warn("Could not clear superseded model weights", cause);
};

const downloadInOrder = async <T>(
  model: ModelSpec,
  onProgress: FileProgress,
  keepFile: FetchFile<T>,
): Promise<void> => {
  await inOrder(model, onProgress, keepFile, ignore);
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

export { CATALOGUED, downloadInOrder, fileUrls, openInOrder };
export type { FileProgress, Persistence };

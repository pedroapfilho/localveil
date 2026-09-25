import type { EntityPrompt } from "./gliner-labels";
import { MULTI_PII_PROMPTS, PII_BASE_PROMPTS } from "./gliner-labels";

type ModelLanguage = "en" | "es" | "pt";

type ModelDecoding = "span" | "token";

type ModelSpec = {
  bytes: number;
  card: string;
  decoding: ModelDecoding;
  file: string;
  id: string;
  languages: ReadonlyArray<ModelLanguage>;
  maxPrompts: number;
  maxWidth: number;
  name: string;
  prompts: ReadonlyArray<EntityPrompt>;
  repo: string;
  revision: string;
};

const HUB = "https://huggingface.co";

/* Span-level graphs score every span up to maxWidth words; token-level graphs score each word as
   a start, an end or inside and leave the spans to the decoder. Revisions are commit SHAs, so a
   resumed download never splices two revisions. A file is listed only once it has run on native
   CPU, browser wasm and WebGPU without the collapse the multilingual int8 export shows. */
const MODELS = [
  {
    bytes: 893_933_650,
    card: "https://huggingface.co/urchade/gliner_multi_pii-v1",
    decoding: "span",
    file: "model_q4.onnx",
    id: "gliner-multi-pii",
    languages: ["en", "es", "pt"],
    maxPrompts: 25,
    maxWidth: 12,
    name: "GLiNER multi PII",
    prompts: MULTI_PII_PROMPTS,
    repo: "onnx-community/gliner_multi_pii-v1",
    revision: "2e0397a7e8a250d76c37122232b3cbde42c8d629",
  },
  {
    bytes: 196_757_174,
    card: "https://huggingface.co/knowledgator/gliner-pii-base-v1.0",
    decoding: "span",
    file: "model_quint8.onnx",
    id: "gliner-pii-base",
    languages: ["en"],
    maxPrompts: 100,
    maxWidth: 12,
    name: "GLiNER PII base",
    prompts: PII_BASE_PROMPTS,
    repo: "knowledgator/gliner-pii-base-v1.0",
    revision: "61726e0ad791dcab3e29339bbec3ad42ded65641",
  },
  {
    bytes: 45_820_894,
    card: "https://huggingface.co/knowledgator/gliner-pii-edge-v1.0",
    decoding: "token",
    file: "model_quint8.onnx",
    id: "gliner-pii-edge",
    languages: ["en"],
    maxPrompts: 100,
    maxWidth: 12,
    name: "GLiNER PII edge",
    prompts: PII_BASE_PROMPTS,
    repo: "knowledgator/gliner-pii-edge-v1.0",
    revision: "9b7f39b0a2da971a5beea78d35f1539d4009c891",
  },
] as const satisfies ReadonlyArray<ModelSpec>;

type ModelId = (typeof MODELS)[number]["id"];

const DEFAULT_MODEL_ID: ModelId = "gliner-multi-pii";

for (const model of MODELS) {
  if (model.prompts.length > model.maxPrompts) {
    throw new RangeError(
      `${model.repo} was trained with at most ${String(model.maxPrompts)} entity types per pass`,
    );
  }
}

const isModelId = (value: string): value is ModelId => MODELS.some((model) => model.id === value);

const modelById = (id: ModelId): ModelSpec => {
  const found = MODELS.find((model) => model.id === id);

  if (found === undefined) {
    throw new RangeError(`No model is catalogued as ${id}`);
  }

  return found;
};

const revisionUrl = (model: ModelSpec) => `${HUB}/${model.repo}/resolve/${model.revision}/`;

const weightsUrl = (model: ModelSpec) => `${revisionUrl(model)}onnx/${model.file}`;

const tokenizerUrls = (model: ModelSpec): [tokenizer: string, config: string] => [
  `${revisionUrl(model)}tokenizer.json`,
  `${revisionUrl(model)}tokenizer_config.json`,
];

export { DEFAULT_MODEL_ID, isModelId, modelById, MODELS, revisionUrl, tokenizerUrls, weightsUrl };
export type { ModelDecoding, ModelId, ModelLanguage, ModelSpec };

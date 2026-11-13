import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { createDetector, patternSpans, readModelFiles } from "@repo/pii-detect";
import { DEFAULT_MODEL_ID, isModelId, MODELS } from "@repo/pii-detect/models";
import type { PiiLabel, Span } from "@repo/redact-core";
import { APPLY_SCORE } from "@repo/redact-core";
import { TEXT_REDACTORS, withFields } from "@repo/redact/text";

import type { EvalDocument } from "./corpus";
import { loadCorpus } from "./corpus";
import type { Row } from "./report";
import { table } from "./report";
import type { Counts } from "./score";
import { addCounts, countMatches, totalCounts } from "./score";

type DocumentResult = {
  analysed: Map<PiiLabel, Counts>;
  everything: Map<PiiLabel, Counts>;
  exact: Map<PiiLabel, Counts>;
  id: string;
  language: EvalDocument["language"];
  overlap: Map<PiiLabel, Counts>;
  patterns: Map<PiiLabel, Counts>;
  predicted: Array<Span>;
};

const RESULTS_DIR = path.join(import.meta.dirname, "..", "results");

const note = (message: string) => {
  process.stderr.write(`${message}\n`);
};

const rowsByLabel = (
  results: Array<DocumentResult>,
  pick: (result: DocumentResult) => Map<PiiLabel, Counts>,
) => {
  const merged = results.reduce(
    (into, result) => addCounts(into, pick(result)),
    new Map<PiiLabel, Counts>(),
  );

  const rows: Array<Row> = [...merged.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([label, counts]) => ({ counts, name: label }));

  return [...rows, { counts: totalCounts(merged), name: "TOTAL" }];
};

const rowsByLanguage = (results: Array<DocumentResult>) => {
  const merged = new Map<string, Map<PiiLabel, Counts>>();

  for (const result of results) {
    merged.set(
      result.language,
      addCounts(merged.get(result.language) ?? new Map<PiiLabel, Counts>(), result.overlap),
    );
  }

  return [...merged.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([language, counts]) => ({ counts: totalCounts(counts), name: language }));
};

// The text redactor's own analysis, fed what the model found, so this scores the review list itself.
const analysedSpans = async (document: EvalDocument, predicted: Array<Span>) => {
  const { detections } = await TEXT_REDACTORS[document.format].analyse(
    new File([document.text], document.id),
    () => Promise.resolve(predicted),
    () => undefined,
  );

  return detections;
};

const scoreDocument = async (
  document: EvalDocument,
  predicted: Array<Span>,
): Promise<DocumentResult> => {
  const detected = await withFields(document.format, () => Promise.resolve(predicted))(
    document.text,
  );

  return {
    analysed: countMatches(document.spans, await analysedSpans(document, predicted)),
    everything: countMatches(document.spans, detected),
    exact: countMatches(document.spans, predicted, true),
    id: document.id,
    language: document.language,
    overlap: countMatches(document.spans, predicted),
    patterns: countMatches(document.spans, patternSpans(document.text)),
    predicted,
  };
};

const run = async () => {
  const { values } = parseArgs({
    options: {
      candidate: { type: "string" },
      filter: { type: "string" },
      json: { type: "boolean" },
      model: { type: "string" },
    },
  });

  const model = values.model ?? DEFAULT_MODEL_ID;

  if (!isModelId(model)) {
    throw new RangeError(
      `--model takes one of ${MODELS.map((entry) => entry.id).join(", ")}, not ${model}`,
    );
  }

  const corpus = await loadCorpus();

  const chosen =
    values.filter === undefined
      ? corpus
      : corpus.filter((document) => document.id.includes(values.filter ?? ""));

  if (chosen.length === 0) {
    throw new Error(`No corpus document matches ${String(values.filter)}`);
  }

  note(
    `Scoring ${String(chosen.length)} documents with ${model}${values.candidate === undefined ? "" : ` from ${values.candidate}`}.`,
  );

  const floor = process.env.EVAL_MIN_SCORE;

  const candidate = values.candidate;

  const files =
    candidate === undefined
      ? undefined
      : await readModelFiles((name) => readFile(path.join(candidate, name)));

  const detect = await createDetector({
    files,
    minScore: floor === undefined ? APPLY_SCORE : Number(floor),
    model,
    onLoad: (event) => {
      if (event.kind === "loading" && event.downloaded !== undefined) {
        note(`  downloading ${(event.downloaded * 100).toFixed(0)}%`);
      }
    },
  });

  if (floor !== undefined) {
    note(`  score floor overridden to ${floor}`);
  }

  const results: Array<DocumentResult> = [];

  for (const document of chosen) {
    note(`  ${document.id}`);
    results.push(await scoreDocument(document, await detect(document.text)));
  }

  const report = [
    table(
      "Detection, overlap matching",
      rowsByLabel(results, (result) => result.overlap),
    ),
    table(
      "Detection, exact boundaries",
      rowsByLabel(results, (result) => result.exact),
    ),
    table("By language, overlap matching", rowsByLanguage(results)),
    table(
      "Pattern layer alone, overlap matching",
      rowsByLabel(results, (result) => result.patterns),
    ),
    table(
      "Detection plus the structural layer, overlap matching",
      rowsByLabel(results, (result) => result.everything),
    ),
    table(
      "Whole analysis, overlap matching",
      rowsByLabel(results, (result) => result.analysed),
    ),
  ].join("\n\n");

  const stamp = process.env.EVAL_STAMP ?? "latest";
  const file = path.join(RESULTS_DIR, `${stamp}.json`);

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      results.map((result) => ({
        id: result.id,
        language: result.language,
        predicted: result.predicted,
      })),
      undefined,
      2,
    ),
  );

  process.stdout.write(values.json === true ? "" : `${report}\n`);
  note(`Wrote ${file}`);
};

await run();

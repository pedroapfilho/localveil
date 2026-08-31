import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { createDetector } from "@repo/pii-detect";
import type { PiiLabel, Span } from "@repo/redact-core";
import {
  APPLY_SCORE,
  definedTerms,
  dropDefinedTerms,
  patternSpans,
  spansForTokens,
  tokensFromSpans,
} from "@repo/redact-core";
import { structuralSpans } from "@repo/redact-text";

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

const FORMATS = [".csv", ".json"] as const;

const filenameOf = (id: string) =>
  `${id}${FORMATS.find((format) => id.endsWith(format.slice(1))) ?? ".txt"}`;

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

/* What a redactor hands the review list: the detector, the structural layer, the repeats the
   first two justify, and the defined terms dropped back out. redact-text composes these in the
   same order. */
const analysedSpans = (text: string, detected: Array<Span>) => {
  const repeated = spansForTokens(text, tokensFromSpans(text, detected));

  return dropDefinedTerms([...detected, ...repeated], text, definedTerms(text, detected));
};

const scoreDocument = (document: EvalDocument, predicted: Array<Span>): DocumentResult => {
  const structural = structuralSpans(filenameOf(document.id), document.text);
  const detected = [...predicted, ...structural];

  return {
    analysed: countMatches(document.spans, analysedSpans(document.text, detected)),
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
      filter: { type: "string" },
      json: { type: "boolean" },
    },
  });

  const corpus = await loadCorpus();
  const chosen =
    values.filter === undefined
      ? corpus
      : corpus.filter((document) => document.id.includes(values.filter ?? ""));

  if (chosen.length === 0) {
    throw new Error(`No corpus document matches ${String(values.filter)}`);
  }

  note(`Scoring ${String(chosen.length)} documents. The first run downloads the model.`);

  const floor = process.env.EVAL_MIN_SCORE;

  const detect = await createDetector({
    minScore: floor === undefined ? APPLY_SCORE : Number(floor),
    onProgress: (fraction, stage) => {
      if (stage === "model.downloading") {
        note(`  ${stage} ${(fraction * 100).toFixed(0)}%`);
      }
    },
    resumableCache: false,
  });

  if (floor !== undefined) {
    note(`  score floor overridden to ${floor}`);
  }

  const results: Array<DocumentResult> = [];

  /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
  for (const document of chosen) {
    note(`  ${document.id}`);
    results.push(scoreDocument(document, await detect(document.text)));
  }
  /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

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

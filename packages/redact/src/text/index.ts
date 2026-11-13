import type { Detect, Span } from "@repo/redact-core";
import { mergeOverlappingRanges } from "@repo/redact-core";

import { analyseUnits, keptSpans } from "../pipeline/analysis";
import type { Redactor } from "../pipeline/types";

import { maskRanges } from "./mask";
import { csvBody, csvFieldSpans } from "./structured-csv";
import { jsonFieldSpans } from "./structured-json";

/* A structured format names its fields, so a value under a field called "email" is covered whether
   or not the model saw it. Verification reads only the body: a CSV header names a column, and the
   model would tag "email" there as the very thing it heads. */
type TextStructure = { body: (text: string) => string; fieldSpans: (text: string) => Array<Span> };

const whole = (text: string) => text;

const STRUCTURES = {
  csv: { body: csvBody, fieldSpans: csvFieldSpans },
  json: { body: whole, fieldSpans: jsonFieldSpans },
  text: { body: whole, fieldSpans: () => [] },
} satisfies Record<string, TextStructure>;

type TextFormat = keyof typeof STRUCTURES;

const isTextFormat = (value: unknown): value is TextFormat =>
  typeof value === "string" && Object.hasOwn(STRUCTURES, value);

const withFields =
  (format: TextFormat, detect: Detect): Detect =>
  async (text) => [...(await detect(text)), ...STRUCTURES[format].fieldSpans(text)];

const createTextRedactor = (format: TextFormat): Redactor => {
  const { body } = STRUCTURES[format];

  return {
    analyse: async (file, detect, onProgress) => {
      onProgress(0, "stage.reading");

      const text = await file.text();

      onProgress(0.2, "stage.detecting");

      const { detections, units } = await analyseUnits({
        detect: withFields(format, detect),
        kind: "file",
        units: [{ text }],
      });

      return { detections, units, warnings: text.length === 0 ? ["warning.noText"] : [] };
    },
    apply: ({ analysis, decisions, file, onProgress }) => {
      onProgress(0.8, "stage.redacting");

      const [[reading] = []] = analysis.units;

      if (reading === undefined) {
        return Promise.reject(new TypeError("The text analysis carried no source text to mask"));
      }

      const masked = maskRanges(
        reading.text,
        mergeOverlappingRanges(keptSpans(reading, decisions)),
      );

      return Promise.resolve({
        blob: new Blob([masked], { type: file.type }),
        name: file.name,
        visible: body(masked),
        warnings: [],
      });
    },
  };
};

const TEXT_REDACTORS = {
  csv: createTextRedactor("csv"),
  json: createTextRedactor("json"),
  text: createTextRedactor("text"),
} satisfies Record<TextFormat, Redactor>;

export { isTextFormat, TEXT_REDACTORS, withFields };

export type { TextFormat };

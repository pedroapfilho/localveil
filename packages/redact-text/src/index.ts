import type { Redactor, WarningKey } from "@repo/redact-core";
import {
  dedupeDetections,
  describeSpans,
  keptSpans,
  mergeOverlappingRanges,
  spansForTokens,
  survivingSpans,
  tokensFromSpans,
} from "@repo/redact-core";

import { maskRanges } from "./mask.ts";
import { csvFieldSpans } from "./structured-csv.ts";
import { jsonFieldSpans } from "./structured-json.ts";

const TEXT_EXTENSIONS = new Set([".csv", ".json", ".log", ".md", ".txt"]);

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const hasTextExtension = (name: string) => TEXT_EXTENSIONS.has(extensionOf(name));

// A CSV header is never redacted: the column names are what the structural layer reads, and
// covering them would destroy the file's shape for no privacy gain. The verify pass has to skip
// it, or a column called email is reported as a surviving email on every structured file.
const verifiable = (name: string, text: string) => {
  if (extensionOf(name) !== ".csv") {
    return text;
  }

  const firstBreak = text.indexOf("\n");

  return firstBreak === -1 ? "" : text.slice(firstBreak + 1);
};

const structuralSpans = (name: string, text: string) => {
  const extension = extensionOf(name);

  if (extension === ".csv") {
    return csvFieldSpans(text);
  }

  return extension === ".json" ? jsonFieldSpans(text) : [];
};

// The offsets in the analysis index this exact string. Re-reading the File would substitute a
// different one, and a same-length edit would then cover the wrong bytes while leaving the real
// ones showing, so a missing snapshot has to fail rather than fall back.
const analysedText = (handle: unknown): string => {
  if (typeof handle !== "string") {
    throw new TypeError("The text analysis carried no source text to mask");
  }

  return handle;
};

const textRedactor: Redactor = {
  accepts: (file) => file.type.startsWith("text/") || hasTextExtension(file.name),
  analyse: async (file, detect, onProgress) => {
    onProgress(0, "stage.reading");

    const text = await file.text();

    if (text.length === 0) {
      onProgress(1, "stage.finished");

      return { detections: [], handle: text, warnings: ["warning.noText"] };
    }

    onProgress(0.2, "stage.detecting");

    const found = await detect(text);
    const structural = structuralSpans(file.name, text);
    const detected = [...found, ...structural];
    const repeated = spansForTokens(text, tokensFromSpans(text, detected));

    onProgress(1, "stage.finished");

    return {
      detections: dedupeDetections(describeSpans([...detected, ...repeated], text)),
      handle: text,
      warnings: [],
    };
  },
  apply: async ({ analysis, decisions, detect, file, onProgress }) => {
    onProgress(0.8, "stage.redacting");

    const text = analysedText(analysis.handle);
    const ranges = mergeOverlappingRanges(keptSpans(analysis.detections, decisions));
    const masked = maskRanges(text, ranges);
    const survivors = await survivingSpans(verifiable(file.name, masked), detect);
    const warnings: Array<WarningKey> = [...analysis.warnings];

    if (survivors.length > 0) {
      warnings.push("warning.notFullyRedacted");
    }

    onProgress(1, "stage.finished");

    return {
      blob: new Blob([masked], { type: file.type }),
      redactionCount: ranges.length,
      warnings,
    };
  },
};

export { structuralSpans, textRedactor };

import type { Redactor, Span, WarningKey } from "@repo/redact-core";
import {
  dedupeDetections,
  describeSpans,
  keptSpans,
  mergeOverlappingRanges,
  spansForTokens,
  survivingSpans,
  tokensFromSpans,
} from "@repo/redact-core";

import { maskSpans } from "./mask.ts";
import { csvFieldSpans } from "./structured-csv.ts";
import { jsonFieldSpans } from "./structured-json.ts";

const TEXT_EXTENSIONS = new Set([".csv", ".json", ".log", ".md", ".txt"]);

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const hasTextExtension = (name: string) => TEXT_EXTENSIONS.has(extensionOf(name));

const structuralSpans = (name: string, text: string) => {
  const extension = extensionOf(name);

  if (extension === ".csv") {
    return csvFieldSpans(text);
  }

  return extension === ".json" ? jsonFieldSpans(text) : [];
};

const isPattern = (span: Span) => span.score === 1;

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
      detections: dedupeDetections([
        ...describeSpans({
          source: "model",
          spans: found.filter((span) => !isPattern(span)),
          text,
        }),
        ...describeSpans({ source: "pattern", spans: found.filter(isPattern), text }),
        ...describeSpans({ source: "structure", spans: structural, text }),
        ...describeSpans({ source: "repeat", spans: repeated, text }),
      ]),
      handle: text,
      warnings: [],
    };
  },
  apply: async ({ analysis, decisions, detect, file, onProgress }) => {
    onProgress(0.8, "stage.redacting");

    const text = typeof analysis.handle === "string" ? analysis.handle : await file.text();
    const spans = keptSpans(analysis.detections, decisions);
    const masked = maskSpans(text, spans);
    const survivors = await survivingSpans(masked, detect);
    const warnings: Array<WarningKey> = [...analysis.warnings];

    if (survivors.length > 0) {
      warnings.push("warning.notFullyRedacted");
    }

    onProgress(1, "stage.finished");

    return {
      blob: new Blob([masked], { type: file.type }),
      redactionCount: mergeOverlappingRanges(spans).length,
      warnings,
    };
  },
};

export { structuralSpans, textRedactor };

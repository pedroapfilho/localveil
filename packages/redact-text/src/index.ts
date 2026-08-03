import type { Redactor } from "@repo/redact-core";
import { mergeOverlappingRanges, spansForTokens, tokensFromSpans } from "@repo/redact-core";

import { maskSpans } from "./mask.ts";

const TEXT_EXTENSIONS = new Set([".csv", ".json", ".log", ".md", ".txt"]);

const hasTextExtension = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
};

const textRedactor: Redactor = {
  accepts: (file) => file.type.startsWith("text/") || hasTextExtension(file.name),
  redact: async (file, detect, onProgress) => {
    onProgress(0, "stage.reading");

    const text = await file.text();

    if (text.length === 0) {
      onProgress(1, "stage.finished");

      return {
        blob: new Blob([text], { type: file.type }),
        redactionCount: 0,
        warnings: ["warning.noText"],
      };
    }

    onProgress(0.2, "stage.detecting");

    const detected = await detect(text);

    const spans = [...detected, ...spansForTokens(text, tokensFromSpans(text, detected))];

    onProgress(0.8, "stage.redacting");

    const masked = maskSpans(text, spans);

    onProgress(1, "stage.finished");

    return {
      blob: new Blob([masked], { type: file.type }),
      redactionCount: mergeOverlappingRanges(spans).length,
      warnings: [],
    };
  },
};

export { textRedactor };

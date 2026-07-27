import type { Redactor } from "@repo/redact-core";
import { mergeOverlappingRanges } from "@repo/redact-core";

import { maskSpans } from "./mask.ts";

const TEXT_EXTENSIONS = new Set([".csv", ".json", ".log", ".md", ".txt"]);

const hasTextExtension = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
};

const textRedactor: Redactor = {
  accepts: (file) => file.type.startsWith("text/") || hasTextExtension(file.name),
  redact: async (file, detect, onProgress) => {
    onProgress(0, "Reading file");

    const text = await file.text();

    if (text.length === 0) {
      onProgress(1, "Done");

      return {
        blob: new Blob([text], { type: file.type }),
        redactionCount: 0,
        warnings: ["File is empty"],
      };
    }

    onProgress(0.2, "Detecting personal data");

    const spans = await detect(text);

    onProgress(0.8, "Masking personal data");

    const masked = maskSpans(text, spans);

    onProgress(1, "Done");

    return {
      blob: new Blob([masked], { type: file.type }),
      redactionCount: mergeOverlappingRanges(spans).length,
      warnings: [],
    };
  },
};

export { textRedactor };

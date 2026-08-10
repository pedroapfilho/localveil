import type { Redactor, WarningKey } from "@repo/redact-core";
import {
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

    const detected = [...(await detect(text)), ...structuralSpans(file.name, text)];

    const spans = [...detected, ...spansForTokens(text, tokensFromSpans(text, detected))];

    onProgress(0.8, "stage.redacting");

    const masked = maskSpans(text, spans);
    const survivors = await survivingSpans(masked, detect);
    const warnings: Array<WarningKey> = survivors.length > 0 ? ["warning.notFullyRedacted"] : [];

    onProgress(1, "stage.finished");

    return {
      blob: new Blob([masked], { type: file.type }),
      redactionCount: mergeOverlappingRanges(spans).length,
      warnings,
    };
  },
};

export { structuralSpans, textRedactor };

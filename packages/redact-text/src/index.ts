import type { Detect, Redactor } from "@repo/redact-core";
import {
  analyseUnits,
  isAnalysedReading,
  keptSpans,
  mergeOverlappingRanges,
  redactionCount,
  verifyOutput,
} from "@repo/redact-core";

import { ignoringMasks, maskRanges } from "./mask";
import { csvBody, csvFieldSpans } from "./structured-csv";
import { jsonFieldSpans } from "./structured-json";

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const verifiable = (name: string, text: string) =>
  extensionOf(name) === ".csv" ? csvBody(text) : text;

const structuralSpans = (name: string, text: string) => {
  const extension = extensionOf(name);

  if (extension === ".csv") {
    return csvFieldSpans(text);
  }

  return extension === ".json" ? jsonFieldSpans(text) : [];
};

const withStructure =
  (name: string, detect: Detect): Detect =>
  async (text) => [...(await detect(text)), ...structuralSpans(name, text)];

const textRedactor: Redactor = {
  analyse: async (file, detect, onProgress) => {
    onProgress(0, "stage.reading");

    const text = await file.text();

    onProgress(0.2, "stage.detecting");

    const {
      detections,
      units: [[handle] = []],
    } = await analyseUnits({
      detect: withStructure(file.name, detect),
      kind: "file",
      units: [{ text }],
    });

    onProgress(1, "stage.finished");

    return { detections, handle, warnings: text.length === 0 ? ["warning.noText"] : [] };
  },
  apply: async ({ analysis, decisions, detect, file, onProgress }) => {
    onProgress(0.8, "stage.redacting");

    const reading = analysis.handle;

    if (!isAnalysedReading(reading)) {
      throw new TypeError("The text analysis carried no source text to mask");
    }

    const masked = maskRanges(reading.text, mergeOverlappingRanges(keptSpans(reading, decisions)));
    const warnings = await verifyOutput(
      verifiable(file.name, masked),
      ignoringMasks(detect),
      analysis.warnings,
    );

    onProgress(1, "stage.finished");

    return {
      blob: new Blob([masked], { type: file.type }),
      redactionCount: redactionCount([[reading]], decisions),
      warnings,
    };
  },
};

export { structuralSpans, textRedactor };

import type { AnalysedReading, Detect, Redactor } from "@repo/redact-core";
import {
  analyseUnits,
  isAnalysedReading,
  keptSpans,
  mergeOverlappingRanges,
  redactionCount,
  verifyOutput,
} from "@repo/redact-core";

import { ignoringMasks, maskRanges } from "./mask";
import { csvFieldSpans } from "./structured-csv";
import { jsonFieldSpans } from "./structured-json";

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

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

const withStructure =
  (name: string, detect: Detect): Detect =>
  async (text) => [...(await detect(text)), ...structuralSpans(name, text)];

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the analysis handle round-trips through the caller untyped; this guard is its parser
const analysedText = (handle: unknown): AnalysedReading => {
  if (!isAnalysedReading(handle)) {
    throw new TypeError("The text analysis carried no source text to mask");
  }

  return handle;
};

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

    const reading = analysedText(analysis.handle);
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

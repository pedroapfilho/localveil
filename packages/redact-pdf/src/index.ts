import type { OcrLanguage } from "@repo/ocr";
import { detectLanguage, legibleWords, muchWasUnreadable, readImageText } from "@repo/ocr";
import type { PiiToken, PositionedWord, Rect, Redactor, Span, WarningKey } from "@repo/redact-core";
import {
  buildWordIndex,
  mergeOverlappingRanges,
  spansForTokens,
  spansToRects,
  toArrayBuffer,
  tokensFromSpans,
} from "@repo/redact-core";
import type { PDFDocument } from "pdf-lib";

import { OffscreenCanvasFactory } from "./canvas-factory.ts";
import { isCovered } from "./covered.ts";
import { NoFilterFactory } from "./filter-factory.ts";

const SCALE = 2;

const MIN_TEXT_WORDS = 4;

const MIN_LANGUAGE_CONFIDENCE = 0.5;

let parserInstalled: Promise<void> | undefined;

const installParser = async () => {
  // oxlint-disable-next-line react-doctor/async-defer-await
  await import("pdfjs-dist/build/pdf.worker.mjs");

  if (Reflect.get(globalThis, "pdfjsWorker") === undefined) {
    throw new Error("pdf.js loaded without registering its parser, so no PDF can be read");
  }
};

const documentOptions = (data: Uint8Array) => ({
  CanvasFactory: OffscreenCanvasFactory,
  data,
  disableFontFace: true,
  FilterFactory: NoFilterFactory,
});

const contextOf = (canvas: OffscreenCanvas) => {
  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("This browser gave no 2d canvas to render the page on");
  }

  return context;
};

const paint = (canvas: OffscreenCanvas, rects: Array<Rect>) => {
  const context = contextOf(canvas);

  context.fillStyle = "#000000";

  for (const rect of rects) {
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
};

const redactPdf: Redactor["redact"] = async (file, detect, onProgress, options) => {
  onProgress(0, "stage.reading");

  parserInstalled ??= installParser();

  // oxlint-disable-next-line react-doctor/async-parallel
  const [pdfjs, pdfLib, source] = await Promise.all([
    import("pdfjs-dist"),
    import("pdf-lib"),
    file.arrayBuffer(),

    parserInstalled,
  ]);

  const opened = pdfjs.getDocument(documentOptions(new Uint8Array(source)));
  const [pdf, out] = await Promise.all([opened.promise, pdfLib.PDFDocument.create()]);

  const font = await out.embedFont(pdfLib.StandardFonts.Helvetica);

  const warnings = new Set<WarningKey>();
  const read: Array<{ spans: Array<Span>; text: string; words: Array<PositionedWord> }> = [];
  const tokens = new Map<string, PiiToken>();

  let language: OcrLanguage | undefined = options?.language;
  let anyText = false;

  let original: Promise<PDFDocument> | undefined;
  let copying = true;

  const copyPage = async (number: number) => {
    if (!copying) {
      return false;
    }

    try {
      const from = await (original ??= file
        .arrayBuffer()
        .then((bytes) => pdfLib.PDFDocument.load(bytes)));
      const [copied] = await out.copyPages(from, [number - 1]);

      out.addPage(copied);

      return true;
    } catch (error) {
      copying = false;

      // oxlint-disable-next-line eslint/no-console
      console.warn("Could not copy an untouched page, so it is painted instead", error);

      return false;
    }
  };

  const renderPage = async (number: number) => {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const target = contextOf(canvas) as unknown as CanvasRenderingContext2D;

    await page.render({
      background: "#FFFFFF",
      canvas: null,
      canvasContext: target,
      viewport,
    }).promise;

    return { canvas, page, viewport };
  };

  /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

  for (let number = 1; number <= pdf.numPages; number += 1) {
    const progress = ((number - 1) / pdf.numPages) * 0.7;

    onProgress(progress, "stage.rendering");

    const { canvas, page } = await renderPage(number);

    onProgress(progress, "stage.extracting");

    const content = await page.getTextContent();
    const layerText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();

    if (language === undefined && layerText.split(/\s+/v).length >= MIN_TEXT_WORDS) {
      const guess = detectLanguage(layerText);

      language = guess.confidence >= MIN_LANGUAGE_CONFIDENCE ? guess.language : undefined;
    }

    if (layerText.length === 0) {
      warnings.add("warning.scannedPages");
    }

    onProgress(progress, "stage.recognising");

    const reading = await readImageText(canvas, language === undefined ? {} : { known: language });

    language ??= reading.language;

    if (muchWasUnreadable(reading)) {
      warnings.add("warning.lowConfidence");
    }

    anyText ||= reading.words.length > 0;

    onProgress(progress, "stage.detecting");

    const { text, words } = buildWordIndex(legibleWords(reading));
    const spans = await detect(text);

    for (const token of tokensFromSpans(text, spans)) {
      tokens.set(token.text.toLowerCase(), token);
    }

    read.push({ spans, text, words });
    page.cleanup();
  }

  const everyToken = [...tokens.values()];
  let redactionCount = 0;

  for (let number = 1; number <= pdf.numPages; number += 1) {
    const progress = 0.7 + ((number - 1) / pdf.numPages) * 0.3;
    const page = read[number - 1];

    onProgress(progress, "stage.redacting");

    const spans = [...page.spans, ...spansForTokens(page.text, everyToken)];
    const rects = spansToRects(spans, page.words);

    redactionCount += mergeOverlappingRanges(spans).length;

    if (rects.length === 0 && (await copyPage(number))) {
      continue;
    }

    const { canvas, viewport } = await renderPage(number);

    paint(canvas, rects);

    onProgress(progress, "stage.assembling");

    const encoded = await canvas.convertToBlob({ type: "image/png" });
    const png = await out.embedPng(await encoded.arrayBuffer());
    const sheet = out.addPage([viewport.width / SCALE, viewport.height / SCALE]);

    sheet.drawImage(png, {
      height: viewport.height / SCALE,
      width: viewport.width / SCALE,
      x: 0,
      y: 0,
    });

    for (const word of page.words) {
      if (isCovered(word.bbox, rects)) {
        continue;
      }

      try {
        sheet.drawText(word.text, {
          font,
          opacity: 0,
          size: (word.bbox.y1 - word.bbox.y0) / SCALE,
          x: word.bbox.x0 / SCALE,

          y: (viewport.height - word.bbox.y1) / SCALE,
        });
      } catch {
        warnings.add("warning.droppedCharacters");
      }
    }
  }
  /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

  if (!anyText) {
    warnings.add("warning.noText");
  }

  onProgress(1, "stage.finished");

  return {
    blob: new Blob([toArrayBuffer(await out.save())], { type: "application/pdf" }),
    redactionCount,
    warnings: [...warnings],
  };
};

const pdfRedactor: Redactor = {
  accepts: (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
  redact: redactPdf,
};

export { documentOptions, pdfRedactor };

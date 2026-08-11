import type { ImageReading, OcrLanguage } from "@repo/ocr";
import { detectLanguage, legibleWords, muchWasUnreadable, readImageText } from "@repo/ocr";
import type { PiiToken, PositionedWord, Rect, Redactor, Span, WarningKey } from "@repo/redact-core";
import {
  APPLY_SCORE,
  buildWordIndex,
  dedupeDetections,
  describeSpans,
  isCovered,
  keptSpans,
  mergeOverlappingRanges,
  spansForTokens,
  spansToRects,
  survivingSpans,
  toArrayBuffer,
  tokensFromSpans,
} from "@repo/redact-core";
import type { PDFDocument } from "pdf-lib";

import { OffscreenCanvasFactory } from "./canvas-factory.ts";
import { NoFilterFactory } from "./filter-factory.ts";
import { textLayerWords } from "./text-layer.ts";

const SCALE = 2;

const MIN_TEXT_WORDS = 4;

// A page whose own text layer carries at least this many words is read from that layer instead
// of being recognised. Recognition is the dominant cost of a PDF and it is pure loss on a page
// that was typed rather than scanned: it re-derives, worse, text the file already holds.
const MIN_LAYER_WORDS = 12;

const MIN_LANGUAGE_CONFIDENCE = 0.5;

type Page = { spans: Array<Span>; text: string; words: Array<PositionedWord> };

type PdfHandle = { pages: Array<Page> };

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

const openPdf = async (file: File) => {
  parserInstalled ??= installParser();

  // oxlint-disable-next-line react-doctor/async-parallel
  const [pdfjs, pdfLib, source] = await Promise.all([
    import("pdfjs-dist"),
    import("pdf-lib"),
    file.arrayBuffer(),

    parserInstalled,
  ]);

  const opened = pdfjs.getDocument(documentOptions(new Uint8Array(source)));

  return { pdf: await opened.promise, pdfLib };
};

const renderer = (pdf: Awaited<ReturnType<typeof openPdf>>["pdf"]) => async (number: number) => {
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

const isHandle = (value: unknown): value is PdfHandle =>
  typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "pages"));

const analysePdf: Redactor["analyse"] = async (file, detect, onProgress, options) => {
  onProgress(0, "stage.reading");

  const { pdf } = await openPdf(file);
  const renderPage = renderer(pdf);

  const warnings = new Set<WarningKey>();
  const pages: Array<Page> = [];
  const tokens = new Map<string, PiiToken>();

  let language: OcrLanguage | undefined = options?.language;
  let anyText = false;

  /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const progress = ((number - 1) / pdf.numPages) * 0.9;

    onProgress(progress, "stage.extracting");

    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: SCALE });
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

    const typed = textLayerWords({ items: content.items, viewport });
    const readable = typed.length >= MIN_LAYER_WORDS ? typed : undefined;

    let reading: ImageReading;

    if (readable === undefined) {
      onProgress(progress, "stage.rendering");

      const { canvas } = await renderPage(number);

      onProgress(progress, "stage.recognising");

      reading = await readImageText(canvas, language === undefined ? {} : { known: language });
      language ??= reading.language;

      if (muchWasUnreadable(reading)) {
        warnings.add("warning.lowConfidence");
      }
    } else {
      reading = {
        confidence: 100,
        language: language ?? "en",
        words: readable.map((word) => ({ bbox: word.bbox, confidence: 100, text: word.text })),
      };
    }

    anyText ||= reading.words.length > 0;

    onProgress(progress, "stage.detecting");

    const { text, words } = buildWordIndex(legibleWords(reading));
    const spans = await detect(text);

    for (const token of tokensFromSpans(text, spans)) {
      const key = token.text.toLowerCase();
      const existing = tokens.get(key);

      if (existing === undefined || existing.score < token.score) {
        tokens.set(key, token);
      }
    }

    pages.push({ spans, text, words });
    page.cleanup();
  }
  /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

  if (!anyText) {
    warnings.add("warning.noText");
  }

  const everyToken = [...tokens.values()];

  onProgress(1, "stage.finished");

  return {
    detections: dedupeDetections(
      pages.flatMap((page, at) => [
        ...describeSpans({
          applyAbove: APPLY_SCORE,
          page: at,
          source: "model",
          spans: page.spans,
          text: page.text,
        }),
        ...describeSpans({
          applyAbove: APPLY_SCORE,
          page: at,
          source: "repeat",
          spans: spansForTokens(page.text, everyToken),
          text: page.text,
        }),
      ]),
    ),
    handle: { pages } satisfies PdfHandle,
    warnings: [...warnings],
  };
};

const applyPdf: Redactor["apply"] = async ({ analysis, decisions, detect, file, onProgress }) => {
  if (!isHandle(analysis.handle)) {
    throw new TypeError("The PDF analysis carried no recognised pages to paint from");
  }

  const { pages } = analysis.handle;
  const { pdf, pdfLib } = await openPdf(file);
  const renderPage = renderer(pdf);
  const out = await pdfLib.PDFDocument.create();
  const font = await out.embedFont(pdfLib.StandardFonts.Helvetica);

  const warnings = new Set<WarningKey>(analysis.warnings);
  const survived: Array<string> = [];

  let original: Promise<PDFDocument> | undefined;
  let copying = true;
  let redactionCount = 0;

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

  /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
  for (let number = 1; number <= pages.length; number += 1) {
    const progress = ((number - 1) / pages.length) * 0.9;
    const page = pages[number - 1];

    onProgress(progress, "stage.redacting");

    const spans = keptSpans(analysis.detections, decisions, number - 1);
    const rects = spansToRects(spans, page.words);
    const showing = page.words.filter((word) => !isCovered(word.bbox, rects));

    redactionCount += mergeOverlappingRanges(spans).length;
    survived.push(...showing.map((word) => word.text));

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

    for (const word of showing) {
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

  const survivors = await survivingSpans(survived.join(" "), detect);

  if (survivors.length > 0) {
    warnings.add("warning.notFullyRedacted");
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
  analyse: analysePdf,
  apply: applyPdf,
};

export { documentOptions, pdfRedactor };

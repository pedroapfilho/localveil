import type { ImageReading, OcrLanguage } from "@repo/ocr";
import { assessReading, detectLanguage, readImageText } from "@repo/ocr";
import type {
  AnalysedUnit,
  Detect,
  FileProgress,
  PositionedWord,
  Rect,
  Redactor,
  WarningKey,
} from "@repo/redact-core";
import {
  analyseUnits,
  buildWordIndex,
  inReadingOrder,
  isAnalysedUnit,
  isCovered,
  keptSpans,
  redactionCount,
  spansToRects,
  survivingSpans,
  toArrayBuffer,
} from "@repo/redact-core";
import type { PDFDocument } from "pdf-lib";

import { OffscreenCanvasFactory } from "./canvas-factory";
import { NoFilterFactory } from "./filter-factory";
import { textLayerWords } from "./text-layer";

const SCALE = 2;

const MIN_TEXT_WORDS = 4;

const MIN_LAYER_WORDS = 12;

const MIN_LANGUAGE_CONFIDENCE = 0.5;

const READ_SHARE = 0.45;

const DETECT_SHARE = 0.45;

type Page = { text: string; words: Array<PositionedWord> };

type PdfHandle = { pages: Array<AnalysedUnit & Page> };

let parserInstalled: Promise<void> | undefined;

const installParser = async () => {
  await import("#pdfjs-worker");

  if (!("pdfjsWorker" in globalThis)) {
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

  const [pdfjs, pdfLib, source] = await Promise.all([
    import("#pdfjs"),
    import("pdf-lib"),
    file.arrayBuffer(),

    parserInstalled,
  ]);

  const opened = pdfjs.getDocument(documentOptions(new Uint8Array(source)));

  return { loading: opened, pdf: await opened.promise, pdfLib };
};

type OpenedPdf = Awaited<ReturnType<typeof openPdf>>;

type PdfDocument = OpenedPdf["pdf"];

type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

type PdfViewport = ReturnType<PdfPage["getViewport"]>;

const withPdf = async <T>(
  file: File,
  work: (pdf: PdfDocument, pdfLib: OpenedPdf["pdfLib"]) => Promise<T>,
): Promise<T> => {
  const { loading, pdf, pdfLib } = await openPdf(file);

  try {
    return await work(pdf, pdfLib);
  } finally {
    await loading.destroy().catch(() => undefined);
  }
};

const withPage = async <T>(
  pdf: PdfDocument,
  number: number,
  body: (page: PdfPage, viewport: PdfViewport) => Promise<T>,
): Promise<T> => {
  const page = await pdf.getPage(number);

  try {
    return await body(page, page.getViewport({ scale: SCALE }));
  } finally {
    page.cleanup();
  }
};

const render = async (page: PdfPage, viewport: PdfViewport) => {
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);

  /* SAFETY: pdf.js renders onto an offscreen 2d context at runtime, but its RenderParameters
     type only admits a DOM CanvasRenderingContext2D, so the context is forced through unknown. */
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- see the SAFETY note above
  const target = contextOf(canvas) as unknown as CanvasRenderingContext2D;

  await page.render({
    background: "#FFFFFF",
    canvas: null,
    canvasContext: target,
    viewport,
  }).promise;

  return canvas;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the analysis handle round-trips through the caller untyped; this guard is its parser
const hasWords = (page: unknown) =>
  typeof page === "object" && page !== null && "words" in page && Array.isArray(page.words);

const isHandle = (value: unknown): value is PdfHandle =>
  typeof value === "object" &&
  value !== null &&
  "pages" in value &&
  Array.isArray(value.pages) &&
  value.pages.every((page) => hasWords(page) && isAnalysedUnit(page));

const readPages = (file: File, onProgress: FileProgress) =>
  withPdf(file, async (pdf) => {
    onProgress(0, "stage.reading");

    const warnings = new Set<WarningKey>();
    const pages: Array<Page> = [];

    let language: OcrLanguage | undefined;
    let anyText = false;

    for (let number = 1; number <= pdf.numPages; number += 1) {
      const progress = ((number - 1) / pdf.numPages) * READ_SHARE;

      onProgress(progress, "stage.extracting");

      // oxlint-disable-next-line eslint/no-loop-func -- the callback runs to completion inside this iteration's await
      const { hasText, ...built } = await withPage(pdf, number, async (proxy, viewport) => {
        const content = await proxy.getTextContent();
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

        const typed = inReadingOrder(textLayerWords({ items: content.items, viewport }));
        const readable = typed.length >= MIN_LAYER_WORDS ? typed : undefined;

        let reading: ImageReading;

        if (readable === undefined) {
          onProgress(progress, "stage.rendering");

          const canvas = await render(proxy, viewport);

          onProgress(progress, "stage.recognising");

          reading = await readImageText(canvas, language === undefined ? {} : { known: language });
          language ??= reading.language;

          if (assessReading(reading).unreadable) {
            warnings.add("warning.lowConfidence");
          }
        } else {
          reading = {
            confidence: 100,
            language: language ?? "en",
            words: readable.map((word) => ({ bbox: word.bbox, confidence: 100, text: word.text })),
          };
        }

        return {
          hasText: reading.words.length > 0,
          ...buildWordIndex(assessReading(reading).legible),
        };
      });

      anyText ||= hasText;
      pages.push(built);
    }

    if (!anyText) {
      warnings.add("warning.noText");
    }

    return { pages, warnings };
  });

const detectingPages = (detect: Detect, count: number, onProgress: FileProgress): Detect => {
  let detected = 0;

  return (text) => {
    onProgress(READ_SHARE + (detected / count) * DETECT_SHARE, "stage.detecting");
    detected += 1;

    return detect(text);
  };
};

const analysePdf: Redactor["analyse"] = async (file, detect, onProgress) => {
  const { pages, warnings } = await readPages(file, onProgress);
  const { detections, units } = await analyseUnits({
    detect: detectingPages(detect, pages.length, onProgress),
    kind: "pages",
    units: pages,
  });

  onProgress(1, "stage.finished");

  return { detections, handle: { pages: units } satisfies PdfHandle, warnings: [...warnings] };
};

const applyPdf: Redactor["apply"] = async ({ analysis, decisions, detect, file, onProgress }) => {
  if (!isHandle(analysis.handle)) {
    throw new TypeError("The PDF analysis carried no recognised pages to paint from");
  }

  const { pages } = analysis.handle;
  const built = await withPdf(file, async (pdf, pdfLib) => {
    const out = await pdfLib.PDFDocument.create();
    const font = await out.embedFont(pdfLib.StandardFonts.Helvetica);

    const warnings = new Set<WarningKey>(analysis.warnings);
    const survived: Array<string> = [];

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

        // oxlint-disable-next-line eslint/no-console -- the painted fallback is recoverable, so it is surfaced in the console instead of thrown
        console.warn("Could not copy an untouched page, so it is painted instead", error);

        return false;
      }
    };

    for (const [index, page] of pages.entries()) {
      const number = index + 1;
      const progress = (index / pages.length) * 0.9;

      onProgress(progress, "stage.redacting");

      const rects = spansToRects(keptSpans(page, decisions), page.words);
      const showing = page.words.filter((word) => !isCovered(word.bbox, rects));

      survived.push(...showing.map((word) => word.text));

      if (rects.length === 0 && (await copyPage(number))) {
        continue;
      }

      await withPage(pdf, number, async (proxy, viewport) => {
        const canvas = await render(proxy, viewport);

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
      });
    }

    const survivors = await survivingSpans(survived.join(" "), detect);

    if (survivors.length > 0) {
      warnings.add("warning.notFullyRedacted");
    }

    onProgress(1, "stage.finished");

    return {
      blob: new Blob([toArrayBuffer(await out.save())], { type: "application/pdf" }),
      redactionCount: redactionCount("pages", pages, decisions),
      warnings: [...warnings],
    };
  });

  return built;
};

const pdfRedactor: Redactor = {
  analyse: analysePdf,
  apply: applyPdf,
};

export { documentOptions, pdfRedactor };

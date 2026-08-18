import type { ImageReading, OcrLanguage } from "@repo/ocr";
import { assessReading, detectLanguage, readImageText } from "@repo/ocr";
import type { PiiToken, PositionedWord, Rect, Redactor, Span, WarningKey } from "@repo/redact-core";
import {
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

const MIN_LAYER_WORDS = 12;

const MIN_LANGUAGE_CONFIDENCE = 0.5;

type Page = { spans: Array<Span>; text: string; words: Array<PositionedWord> };

type PdfHandle = { pages: Array<{ words: Array<PositionedWord> }> };

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

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const target = contextOf(canvas) as unknown as CanvasRenderingContext2D;

  await page.render({
    background: "#FFFFFF",
    canvas: null,
    canvasContext: target,
    viewport,
  }).promise;

  return canvas;
};

const hasWords = (page: unknown) =>
  typeof page === "object" && page !== null && Array.isArray(Reflect.get(page, "words"));

const isHandle = (value: unknown): value is PdfHandle => {
  const pages: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, "pages") : undefined;

  return Array.isArray(pages) && pages.every((page: unknown) => hasWords(page));
};

const analysePdf: Redactor["analyse"] = (file, detect, onProgress, options) =>
  withPdf(file, async (pdf) => {
    onProgress(0, "stage.reading");

    const warnings = new Set<WarningKey>();
    const pages: Array<Page> = [];
    const tokens = new Map<string, PiiToken>();

    let language: OcrLanguage | undefined = options?.language;
    let anyText = false;

    /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const progress = ((number - 1) / pdf.numPages) * 0.9;

      onProgress(progress, "stage.extracting");

      // oxlint-disable-next-line eslint/no-loop-func
      const built = await withPage(pdf, number, async (proxy, viewport) => {
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

        const typed = textLayerWords({ items: content.items, viewport });
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

        anyText ||= reading.words.length > 0;

        onProgress(progress, "stage.detecting");

        const { text, words } = buildWordIndex(assessReading(reading).legible);
        const spans = await detect(text);

        for (const token of tokensFromSpans(text, spans)) {
          const key = token.text.toLowerCase();
          const existing = tokens.get(key);

          if (existing === undefined || existing.score < token.score) {
            tokens.set(key, token);
          }
        }

        return { spans, text, words };
      });

      pages.push(built);
    }
    /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

    if (!anyText) {
      warnings.add("warning.noText");
    }

    const everyToken = [...tokens.values()];

    onProgress(1, "stage.finished");

    return {
      detections: dedupeDetections(
        pages.flatMap((page, at) =>
          describeSpans([...page.spans, ...spansForTokens(page.text, everyToken)], page.text, at),
        ),
      ),
      handle: { pages: pages.map(({ words }) => ({ words })) } satisfies PdfHandle,
      warnings: [...warnings],
    };
  });

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
  });

  return built;
};

const pdfRedactor: Redactor = {
  accepts: (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
  analyse: analysePdf,
  apply: applyPdf,
};

export { documentOptions, pdfRedactor };

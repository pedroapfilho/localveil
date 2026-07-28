import type { OcrLanguage } from "@repo/ocr";
import { detectLanguage, readabilityOf, readImageText } from "@repo/ocr";
import type { PiiToken, PositionedWord, Rect, Redactor, Span, WarningKey } from "@repo/redact-core";
import {
  buildWordIndex,
  mergeOverlappingRanges,
  spansForTokens,
  spansToRects,
  toArrayBuffer,
  tokensFromSpans,
} from "@repo/redact-core";

import { OffscreenCanvasFactory } from "./canvas-factory.ts";
import { isCovered } from "./covered.ts";
import { NoFilterFactory } from "./filter-factory.ts";

// Two device pixels per point: enough that the rebuilt page still reads well at
// normal zoom, and enough resolution for the recogniser to place words precisely.
const SCALE = 2;

// A page carrying almost nothing in its text layer is a scan, so there is no
// language to read off it and the recogniser has to work that out itself.
const MIN_TEXT_WORDS = 4;

// Below this the language guess is not worth acting on, and the recogniser falls
// back to probing in English.
const MIN_LANGUAGE_CONFIDENCE = 0.5;

// pdf.js normally parses in a worker it spawns itself, which would be a worker
// inside the worker this already runs in. Importing the parser registers it on
// `globalThis`, and pdf.js then runs it in this thread: one less thread, and no
// bundler-specific URL for a package that should not know about bundlers.
let parserInstalled: Promise<void> | undefined;

const installParser = async () => {
  // Loading the bundle is the whole job: it registers itself on `globalThis` on the
  // way in. The guard below is reading what this await did, so it cannot move above
  // it the way the rule suggests.
  // oxlint-disable-next-line react-doctor/async-defer-await
  await import("pdfjs-dist/build/pdf.worker.mjs");

  // pdf.js's own fallback for a missing parser is to import `workerSrc`, which is
  // empty here and resolves to the page itself. That surfaces as an HTML MIME type
  // error several layers down, so the check happens here where it can say why.
  if (Reflect.get(globalThis, "pdfjsWorker") === undefined) {
    throw new Error("pdf.js loaded without registering its parser, so no PDF can be read");
  }
};

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

// A PDF's text layer gives runs, not words: "John Smith at" can arrive as one item
// with one box. Splitting that box by character count assumes every character is the
// same width, and in a proportional font the drift across a line reaches a whole
// character, which leaves the first letter of a name showing.
//
// So the layer is read for its words, not their positions, and the boxes come from
// recognising the page that was actually drawn. That costs a recogniser pass on
// every page and buys boxes that sit where the ink is.
const redactPdf: Redactor["redact"] = async (file, detect, onProgress) => {
  onProgress(0, "stage.reading");

  parserInstalled ??= installParser();

  // The three awaits below already run everything that can overlap. What is left is
  // a chain: the document needs the bytes and the library, and the font needs the
  // document. The rule cannot see that through the destructuring.
  // oxlint-disable-next-line react-doctor/async-parallel
  const [pdfjs, pdfLib, source] = await Promise.all([
    import("pdfjs-dist"),
    import("pdf-lib"),
    file.arrayBuffer(),
    // Deliberately last and deliberately not destructured: nothing wants its value,
    // only that the parser is registered before pdf.js is asked for a document.
    parserInstalled,
  ]);

  const [pdf, out] = await Promise.all([
    pdfjs.getDocument({
      CanvasFactory: OffscreenCanvasFactory,
      data: new Uint8Array(source),
      // Embedded fonts normally reach the canvas through an `@font-face` rule, and
      // there is no document in a worker to put one in. Left alone, pdf.js draws
      // every glyph as a .notdef box: a wall of tofu that the recogniser reads as
      // gibberish and the model then tags as one long name. This makes it build the
      // glyph outlines itself, which needs no DOM.
      disableFontFace: true,
      FilterFactory: NoFilterFactory,
    }).promise,
    pdfLib.PDFDocument.create(),
  ]);

  const font = await out.embedFont(pdfLib.StandardFonts.Helvetica);

  const warnings = new Set<WarningKey>();
  const read: Array<{ spans: Array<Span>; text: string; words: Array<PositionedWord> }> = [];
  const tokens = new Map<string, PiiToken>();

  let language: OcrLanguage | undefined;
  let anyText = false;

  const renderPage = async (number: number) => {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);

    // pdf.js draws into an OffscreenCanvas context perfectly well; its types only
    // name the DOM one because the API is older than workers are.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const target = contextOf(canvas) as unknown as CanvasRenderingContext2D;

    // A canvas starts out transparent and pdf.js paints only ink, so without this the
    // recogniser is handed dark glyphs on an undefined background and reads a page of
    // gibberish that the detection model then tags as one long name.
    await page.render({
      background: "#FFFFFF",
      canvas: null,
      canvasContext: target,
      viewport,
    }).promise;

    return { canvas, page, viewport };
  };

  /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
  // First pass reads every page, because a name the model only tags on the last page
  // has to be hidden on the first one too. Pages are rendered again in the second
  // pass rather than held in memory: a hundred A4 canvases is most of a gigabyte.
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

    // Settled once, from the first page that says anything, so a hundred-page
    // document does not ask a hundred times.
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

    const readability = readabilityOf(reading);

    if (readability !== "good" && reading.words.length > 0) {
      warnings.add("warning.lowConfidence");
    }

    anyText ||= reading.words.length > 0;

    onProgress(progress, "stage.detecting");

    const { text, words } = buildWordIndex(reading.words);
    // Nothing is looked for in text the recogniser could not read: see readable.ts.
    const spans = readability === "unreadable" ? [] : await detect(text);

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

    const { canvas, viewport } = await renderPage(number);
    const spans = [...page.spans, ...spansForTokens(page.text, everyToken)];
    const rects = spansToRects(spans, page.words);

    redactionCount += mergeOverlappingRanges(spans).length;
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
          // Canvas counts down from the top of the page, a PDF counts up from the
          // bottom, and pdf-lib places text on its baseline.
          y: (viewport.height - word.bbox.y1) / SCALE,
        });
      } catch {
        // Helvetica cannot write every character. Losing one from the invisible
        // layer costs searchability, never the redaction itself.
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

export { pdfRedactor };

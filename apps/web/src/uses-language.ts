// A forced language only reaches OCR: the PDF and image redactors hand it to the
// recogniser, and the text redactor ignores its options entirely. Offering the control
// on a .txt would be offering one that does nothing.
//
// The predicate is repeated here rather than imported from `pdfRedactor.accepts` and
// `imageRedactor.accepts`, because those modules are code-split out of the first load
// and importing them for a file-name test would pull both pipelines into it.
const OCR_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

const hasOcrExtension = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 && OCR_EXTENSIONS.has(name.slice(dot).toLowerCase());
};

const usesLanguage = (file: File) =>
  file.type === "application/pdf" || file.type.startsWith("image/") || hasOcrExtension(file.name);

export { usesLanguage };

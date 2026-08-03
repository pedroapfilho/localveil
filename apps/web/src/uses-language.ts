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

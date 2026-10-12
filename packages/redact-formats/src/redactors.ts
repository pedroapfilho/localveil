import { readText } from "@repo/ocr";
import type { Redactor } from "@repo/redact-core";
import { UnsupportedFileError } from "@repo/redact-core";
import { createImageRedactor } from "@repo/redact-image";
import { createPdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";

import type { RedactorName } from "./formats";
import { redactorFor } from "./formats";

const REDACTORS: Record<RedactorName, Redactor> = {
  image: createImageRedactor(readText),
  pdf: createPdfRedactor(readText),
  text: textRedactor,
};

const resolveRedactor = (file: File): Redactor => {
  const name = redactorFor(file);

  if (name === undefined) {
    throw new UnsupportedFileError(file.name, file.type);
  }

  return REDACTORS[name];
};

export { resolveRedactor };

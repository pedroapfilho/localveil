import { createImageRedactor } from "../image/index";
import { readText } from "../ocr/read-text";
import { createPdfRedactor } from "../pdf/index";
import type { Redactor } from "../pipeline/types";
import { UnsupportedFileError } from "../pipeline/unsupported-file-error";
import { TEXT_REDACTORS } from "../text/index";

import type { RedactorName } from "./formats";
import { redactorFor } from "./formats";

const REDACTORS: Record<RedactorName, Redactor> = {
  ...TEXT_REDACTORS,
  image: createImageRedactor(readText),
  pdf: createPdfRedactor(readText),
};

const resolveRedactor = (file: File): Redactor => {
  const name = redactorFor(file);

  if (name === undefined) {
    throw new UnsupportedFileError(file.name, file.type);
  }

  return REDACTORS[name];
};

export { resolveRedactor };

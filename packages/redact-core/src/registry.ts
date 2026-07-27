import type { Redactor } from "./types.ts";
import { UnsupportedFileError } from "./unsupported-file-error.ts";

type RedactorRegistry = {
  resolve: (file: File) => Redactor;
};

const createRedactorRegistry = (redactors: Array<Redactor>): RedactorRegistry => ({
  resolve: (file) => {
    const match = redactors.find((redactor) => redactor.accepts(file));

    if (!match) {
      throw new UnsupportedFileError(file.name, file.type);
    }

    return match;
  },
});

export { createRedactorRegistry };
export type { RedactorRegistry };

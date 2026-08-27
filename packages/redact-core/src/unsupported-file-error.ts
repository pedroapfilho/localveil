const UNSUPPORTED_FILE = "UnsupportedFileError";

class UnsupportedFileError extends Error {
  readonly filename: string;
  readonly mimeType: string;

  constructor(filename: string, mimeType: string) {
    super(`${filename} is not a supported file type (${mimeType || "unknown type"})`);
    this.name = UNSUPPORTED_FILE;
    this.filename = filename;
    this.mimeType = mimeType;
  }
}

const isUnsupportedFile = (cause: unknown) =>
  cause instanceof UnsupportedFileError ||
  (cause instanceof Error && cause.name === UNSUPPORTED_FILE);

export { isUnsupportedFile, UnsupportedFileError };

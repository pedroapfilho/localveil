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

const isUnsupportedFile = (error: unknown) =>
  error instanceof UnsupportedFileError ||
  (error instanceof Error && error.name === UNSUPPORTED_FILE);

export { isUnsupportedFile, UnsupportedFileError };

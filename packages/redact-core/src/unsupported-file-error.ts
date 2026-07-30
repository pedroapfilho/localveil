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

// `instanceof` cannot be used across a worker boundary: the error is structured-cloned
// into a plain Error that keeps only its own properties, `name` among them. Keeping
// the comparison here means the class and the string that identifies it stay together,
// rather than the literal being retyped in whichever app catches the failure.
const isUnsupportedFile = (error: unknown) =>
  error instanceof UnsupportedFileError ||
  (error instanceof Error && error.name === UNSUPPORTED_FILE);

export { isUnsupportedFile, UnsupportedFileError };

const UNSUPPORTED_FILE = "UnsupportedFileError";

class UnsupportedFileError extends Error {
  constructor(filename: string, mimeType: string) {
    super(`${filename} is not a supported file type (${mimeType || "unknown type"})`);
    this.name = UNSUPPORTED_FILE;
  }
}

// An error that crossed a worker is a plain Error again, and only its name survives the trip.
const isUnsupportedFile = (cause: unknown) =>
  cause instanceof Error && cause.name === UNSUPPORTED_FILE;

export { isUnsupportedFile, UnsupportedFileError };

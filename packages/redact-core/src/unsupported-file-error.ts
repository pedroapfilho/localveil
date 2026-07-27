class UnsupportedFileError extends Error {
  readonly filename: string;
  readonly mimeType: string;

  constructor(filename: string, mimeType: string) {
    super(`${filename} is not a supported file type (${mimeType || "unknown type"})`);
    this.name = "UnsupportedFileError";
    this.filename = filename;
    this.mimeType = mimeType;
  }
}

export { UnsupportedFileError };

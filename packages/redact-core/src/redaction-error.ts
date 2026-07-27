class RedactionError extends Error {
  readonly filename: string;

  constructor(filename: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RedactionError";
    this.filename = filename;
  }
}

export { RedactionError };

const FAILURE_KEYS = [
  "failure.modelGone",
  "failure.modelSilent",
  "failure.modelUnreadable",
  "failure.unsupported",
  "failure.workerSilent",
] as const;

type FailureKey = (typeof FAILURE_KEYS)[number];

/* A failure the interface can explain carries a key, which crosses a worker the way stages and
   warnings do: workerpool rebuilds an error from its own properties, so the class is lost and the
   key is not. */
class RedactionFailure extends Error {
  readonly key: FailureKey;

  constructor(key: FailureKey, message: string = key) {
    super(message);
    this.key = key;
  }
}

const unsupportedFile = (filename: string, mimeType: string) =>
  new RedactionFailure(
    "failure.unsupported",
    `${filename} is not a supported file type (${mimeType || "unknown type"})`,
  );

const failureKeyOf = (cause: unknown): FailureKey | undefined =>
  typeof cause === "object" && cause !== null && "key" in cause
    ? FAILURE_KEYS.find((key) => key === cause.key)
    : undefined;

export { failureKeyOf, RedactionFailure, unsupportedFile };

export type { FailureKey };

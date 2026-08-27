const describeError = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export { describeError };

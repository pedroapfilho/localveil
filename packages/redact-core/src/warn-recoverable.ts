const warnRecoverable = (message: string, cause: unknown) => {
  // oxlint-disable-next-line eslint/no-console -- a recoverable failure is surfaced in the console instead of thrown
  console.warn(message, cause);
};

export { warnRecoverable };

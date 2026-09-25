// Shared model access spans all its files; removal takes the same lock exclusively.
// Individual files also take an exclusive lock so overlapping readers fetch only once.
const withCacheLock = <T>(
  name: string,
  mode: LockMode,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  const { locks } = globalThis.navigator;

  if (locks === undefined) {
    return Promise.reject(new Error("This browser cannot coordinate model storage"));
  }

  return locks.request(`localveil-model:${name}`, { mode, signal }, run);
};

export { withCacheLock };

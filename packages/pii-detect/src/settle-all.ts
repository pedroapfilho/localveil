// A failed file must not release the model lock while another file is still writing.
const settleAll = async <T extends ReadonlyArray<unknown> | []>(
  pending: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> => {
  await Promise.allSettled(pending);

  return Promise.all(pending);
};

export { settleAll };

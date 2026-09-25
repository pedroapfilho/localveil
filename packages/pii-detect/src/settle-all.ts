// A failed file must not release the model lock while another file is still writing.
const settleAll = async <T>(downloads: ReadonlyArray<Promise<T>>): Promise<Array<T>> => {
  const outcomes = await Promise.allSettled(downloads);

  return outcomes.map((outcome) => {
    if (outcome.status === "rejected") {
      const reason: unknown = outcome.reason;

      throw reason instanceof Error ? reason : new Error(String(reason));
    }

    return outcome.value;
  });
};

export { settleAll };

import type { Detect } from "@repo/redact-core";

const serialiseDetect = (detect: Detect): Detect => {
  let tail: Promise<unknown> = Promise.resolve();

  const after = async (previous: Promise<unknown>, text: string) => {
    await previous;

    return detect(text);
  };

  return (text) => {
    const spans = after(tail, text);

    tail = Promise.allSettled([spans]);

    return spans;
  };
};

export { serialiseDetect };

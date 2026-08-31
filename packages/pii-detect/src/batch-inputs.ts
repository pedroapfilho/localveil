import type { GlinerInput } from "./gliner-encode";

const batchInputs = (
  inputs: Array<GlinerInput>,
  size: number,
  tokenBudget: number,
): Array<Array<number>> => {
  const batches: Array<Array<number>> = [];
  let current: Array<number> = [];
  let widest = 0;

  inputs.forEach((input, at) => {
    const tokens = Math.max(widest, input.inputIds.length);
    const wouldCost = tokens * (current.length + 1);

    if (current.length > 0 && (current.length >= size || wouldCost > tokenBudget)) {
      batches.push(current);
      current = [];
      widest = 0;
    }

    current.push(at);
    widest = Math.max(widest, input.inputIds.length);
  });

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
};

export { batchInputs };

import type { GlinerInput } from "./gliner-codec";

const batchInputs = (
  inputs: Array<GlinerInput>,
  size: number,
  tokenBudget: number,
): Array<Array<GlinerInput>> => {
  const batches: Array<Array<GlinerInput>> = [];
  let current: Array<GlinerInput> = [];
  let widest = 0;

  for (const input of inputs) {
    const tokens = Math.max(widest, input.inputIds.length);
    const wouldCost = tokens * (current.length + 1);

    if (current.length > 0 && (current.length >= size || wouldCost > tokenBudget)) {
      batches.push(current);
      current = [];
      widest = 0;
    }

    current.push(input);
    widest = Math.max(widest, input.inputIds.length);
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
};

export { batchInputs };

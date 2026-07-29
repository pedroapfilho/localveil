import type { GlinerInput } from "./gliner-encode.ts";

type MakeTensor<T> = (
  type: "bool" | "int64",
  data: BigInt64Array | Uint8Array,
  dims: Array<number>,
) => T;

const toBigInts = (values: Array<number>) => BigInt64Array.from(values, BigInt);

const toFeeds = <T>(input: GlinerInput, tensor: MakeTensor<T>): Record<string, T> => {
  const tokens = input.inputIds.length;
  const spans = input.spanMask.length;

  return {
    attention_mask: tensor("int64", toBigInts(input.attentionMask), [1, tokens]),
    input_ids: tensor("int64", toBigInts(input.inputIds), [1, tokens]),
    span_idx: tensor("int64", toBigInts(input.spanIdx), [1, spans, 2]),
    span_mask: tensor("bool", Uint8Array.from(input.spanMask), [1, spans]),
    text_lengths: tensor("int64", toBigInts([input.keptWords.length]), [1, 1]),
    words_mask: tensor("int64", toBigInts(input.wordsMask), [1, tokens]),
  };
};

export { toFeeds };
export type { MakeTensor };

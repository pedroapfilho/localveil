import type { GlinerInput } from "./gliner-encode";

type MakeTensor<T> = (
  type: "bool" | "int64",
  data: BigInt64Array | Uint8Array,
  dims: Array<number>,
) => T;

const toBigInts = (values: Array<number>) => BigInt64Array.from(values, BigInt);

const widest = (inputs: Array<GlinerInput>, of: (input: GlinerInput) => number) =>
  inputs.reduce((most, input) => Math.max(most, of(input)), 0);

const padded = (values: Array<number>, to: number) => [
  ...values,
  ...Array.from({ length: to - values.length }, () => 0),
];

/* Only the inputs the graph declares are built. A span-level export takes all six; a token-level
   one has no span_idx or span_mask, and ONNX Runtime refuses a feed it does not know. */
const toFeeds = <T>(
  inputs: Array<GlinerInput>,
  tensor: MakeTensor<T>,
  names: ReadonlyArray<string>,
): Record<string, T> => {
  const batch = inputs.length;
  const tokens = widest(inputs, (input) => input.inputIds.length);
  const spans = widest(inputs, (input) => input.spanMask.length);

  const flat = (of: (input: GlinerInput) => Array<number>, to: number) =>
    inputs.flatMap((input) => padded(of(input), to));

  const builders = {
    attention_mask: () =>
      tensor("int64", toBigInts(flat((input) => input.attentionMask, tokens)), [batch, tokens]),
    input_ids: () =>
      tensor("int64", toBigInts(flat((input) => input.inputIds, tokens)), [batch, tokens]),
    span_idx: () =>
      tensor("int64", toBigInts(flat((input) => input.spanIdx, spans * 2)), [batch, spans, 2]),
    span_mask: () =>
      tensor("bool", Uint8Array.from(flat((input) => input.spanMask, spans)), [batch, spans]),
    text_lengths: () =>
      tensor("int64", toBigInts(inputs.map((input) => input.keptWords.length)), [batch, 1]),
    words_mask: () =>
      tensor("int64", toBigInts(flat((input) => input.wordsMask, tokens)), [batch, tokens]),
  } satisfies Record<string, () => T>;

  const isFeed = (name: string): name is keyof typeof builders => Object.hasOwn(builders, name);

  return Object.fromEntries(
    names.map((name) => {
      if (!isFeed(name)) {
        throw new TypeError(`The model asks for an input GLiNER does not provide: ${name}`);
      }

      return [name, builders[name]()];
    }),
  );
};

export { toFeeds };
export type { MakeTensor };

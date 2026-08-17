import type { WordInput } from "@repo/redact-core";

type Matrix = ReadonlyArray<number>;

type LayerItem = { height: number; str: string; transform: Matrix; width: number };

type Layer = { items: ReadonlyArray<unknown>; viewport: { transform?: Matrix } };

// A run's box is split between its words by character count, which drifts by up to about one
// character width on a proportional font, so every box is grown by that much on each side.
const BLEED = 1;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const countGraphemes = (value: string) => [...GRAPHEMES.segment(value)].length;

const isLayerItem = (value: unknown): value is LayerItem =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "str") === "string" &&
  typeof Reflect.get(value, "width") === "number" &&
  typeof Reflect.get(value, "height") === "number" &&
  Array.isArray(Reflect.get(value, "transform"));

const compose = (outer: Matrix, inner: Matrix) => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
];

const wordsIn = (item: LayerItem, placed: Matrix, pageScale: number): Array<WordInput> => {
  const glyphs = countGraphemes(item.str);

  if (glyphs === 0 || item.str.trim().length === 0) {
    return [];
  }

  const height = Math.hypot(placed[2], placed[3]) || item.height * pageScale;
  const per = (item.width * pageScale) / glyphs;
  const baseline = placed[5];

  const words: Array<WordInput> = [];
  let at = 0;

  for (const piece of item.str.split(/(?<gap>\s+)/v)) {
    const length = countGraphemes(piece);

    if (piece.trim().length > 0) {
      const x0 = placed[4] + at * per;

      words.push({
        bbox: {
          x0: x0 - per * BLEED,
          x1: x0 + length * per + per * BLEED,
          y0: baseline - height,
          y1: baseline,
        },
        text: piece,
      });
    }

    at += length;
  }

  return words;
};

const textLayerWords = ({ items, viewport }: Layer): Array<WordInput> => {
  const { transform } = viewport;

  if (transform === undefined || transform.length < 6) {
    return [];
  }

  const pageScale = Math.hypot(transform[0], transform[1]);

  return items.flatMap((item) =>
    isLayerItem(item) ? wordsIn(item, compose(transform, item.transform), pageScale) : [],
  );
};

export { textLayerWords };
export type { Layer, LayerItem };

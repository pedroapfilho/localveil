import type { WordInput } from "@repo/redact-core";

type Matrix = readonly [number, number, number, number, number, number];

type LayerItem = { height: number; str: string; transform: ReadonlyArray<unknown>; width: number };

type Layer = { items: ReadonlyArray<unknown>; viewport: { transform?: ReadonlyArray<number> } };

const BLEED = 1;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const countGraphemes = (value: string) => [...GRAPHEMES.segment(value)].length;

const isLayerItem = (value: unknown): value is LayerItem =>
  typeof value === "object" &&
  value !== null &&
  "str" in value &&
  typeof value.str === "string" &&
  "width" in value &&
  typeof value.width === "number" &&
  "height" in value &&
  typeof value.height === "number" &&
  "transform" in value &&
  Array.isArray(value.transform);

const toMatrix = (values: ReadonlyArray<unknown>): Matrix | undefined => {
  const [a, b, c, d, e, f] = values;

  return typeof a === "number" &&
    typeof b === "number" &&
    typeof c === "number" &&
    typeof d === "number" &&
    typeof e === "number" &&
    typeof f === "number"
    ? [a, b, c, d, e, f]
    : undefined;
};

const compose = (outer: Matrix, inner: Matrix): Matrix => [
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
  const page = viewport.transform === undefined ? undefined : toMatrix(viewport.transform);

  if (page === undefined) {
    return [];
  }

  const pageScale = Math.hypot(page[0], page[1]);

  return items.flatMap((item) => {
    if (!isLayerItem(item)) {
      return [];
    }

    const own = toMatrix(item.transform);

    return own === undefined ? [] : wordsIn(item, compose(page, own), pageScale);
  });
};

export { textLayerWords };
export type { Layer };

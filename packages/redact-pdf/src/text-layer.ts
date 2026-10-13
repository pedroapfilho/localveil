import type { WordInput } from "@repo/redact-core";

type Matrix = readonly [number, number, number, number, number, number];

type LayerItem = {
  fontName?: unknown;
  height: number;
  str: string;
  transform: ReadonlyArray<unknown>;
  width: number;
};

type LayerStyle = { ascent: number; descent: number; fontFamily: string };

type Layer = {
  items: ReadonlyArray<unknown>;
  styles: Readonly<Record<string, LayerStyle>>;
  viewport: { transform?: ReadonlyArray<number> };
};

type MeasureText = (text: string, fontFamily: string) => number;

const UNSTYLED: LayerStyle = { ascent: 1, descent: 0, fontFamily: "sans-serif" };

const BLEED = 0.5;

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

type Setting = { measure: MeasureText; pageScale: number; style: LayerStyle };

/* A run only reports its total width, so each word is placed by how much of the run's measured width
   the text before it takes, the way pdf.js lays out its own text layer. Spacing by character count
   drifts with a proportional font and leaves letters past the box. */
const wordsIn = (
  item: LayerItem,
  placed: Matrix,
  { measure, pageScale, style }: Setting,
): Array<WordInput> => {
  const glyphs = countGraphemes(item.str);

  if (glyphs === 0 || item.str.trim().length === 0) {
    return [];
  }

  const height = Math.hypot(placed[2], placed[3]) || item.height * pageScale;
  const width = item.width * pageScale;
  const per = width / glyphs;
  const measured = measure(item.str, style.fontFamily);
  const offsetOf = (graphemes: number, text: string) =>
    measured > 0 ? (measure(text, style.fontFamily) / measured) * width : graphemes * per;
  const baseline = placed[5];

  const words: Array<WordInput> = [];
  let at = 0;
  let before = "";

  for (const piece of item.str.split(/(?<gap>\s+)/v)) {
    const length = countGraphemes(piece);

    if (piece.trim().length > 0) {
      words.push({
        bbox: {
          x0: placed[4] + offsetOf(at, before) - per * BLEED,
          x1: placed[4] + offsetOf(at + length, before + piece) + per * BLEED,
          y0: baseline - height * style.ascent,
          y1: baseline - height * style.descent,
        },
        text: piece,
      });
    }

    at += length;
    before += piece;
  }

  return words;
};

const textLayerWords = (
  { items, styles, viewport }: Layer,
  measure: MeasureText,
): Array<WordInput> => {
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

    const style = typeof item.fontName === "string" ? styles[item.fontName] : undefined;

    return own === undefined
      ? []
      : wordsIn(item, compose(page, own), { measure, pageScale, style: style ?? UNSTYLED });
  });
};

export { textLayerWords };
export type { Layer, MeasureText };

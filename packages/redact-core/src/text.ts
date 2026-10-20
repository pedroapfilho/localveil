const PREVIEW_GRAPHEMES = 80;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const escapeForRegExp = (value: string) =>
  value.replaceAll(/[$*+.?^\\\/\(\)\[\]\{\|\}]/gv, String.raw`\$&`);

const normalise = (value: string) => value.trim().replaceAll(/\s+/gv, " ");

const preview = (value: string) => {
  const segments = [...GRAPHEMES.segment(value)];

  if (segments.length <= PREVIEW_GRAPHEMES) {
    return value;
  }

  return segments
    .slice(0, PREVIEW_GRAPHEMES)
    .map((segment) => segment.segment)
    .join("");
};

export { escapeForRegExp, normalise, preview };

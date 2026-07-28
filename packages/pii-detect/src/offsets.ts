type TokenRange = { end: number; start: number };

type DecodeIds = (ids: Array<number>) => string;

// Anything above this is written as a surrogate pair, so a code point read at the
// position before a boundary being astral means the boundary splits that pair.
const ASTRAL = 0x1_00_00;

const wholeCharacter = (text: string, at: number) =>
  at > 0 && at < text.length && (text.codePointAt(at - 1) ?? 0) >= ASTRAL ? at + 1 : at;

const startOfCharacter = (text: string, at: number) =>
  at > 0 && (text.codePointAt(at - 1) ?? 0) >= ASTRAL ? at - 1 : at;

// The tokenizer does not always give back what it was handed: a space in front of a
// comma comes back missing. Deletions the map absorbs; a substitution runs the walk
// off the end of the source and throws, rather than placing spans against a string
// quietly different from the reader's.
const alignToSource = (text: string, decoded: string) => {
  const map: Array<number> = Array.from({ length: decoded.length + 1 });
  let at = 0;

  // Code units, not code points: the bounds this map is read with are string
  // lengths, and an astral character counts twice in those.
  for (let index = 0; index < decoded.length; index += 1) {
    while (at < text.length && text[at] !== decoded[index]) {
      at += 1;
    }

    if (at >= text.length) {
      throw new Error(
        `The tokenizer returned text the chunk does not contain, from character ${String(index)}, so no span can be placed`,
      );
    }

    map[index] = at;
    at += 1;
  }

  map[decoded.length] = at;

  return map;
};

// The pipeline leaves `start` and `end` unset, because this model ships a slow
// tokenizer, so offsets are rebuilt by prefix length rather than by matching decoded
// tokens against the text. Half-decoding a multi-byte character yields U+FFFD, and a
// scanned page is full of literal U+FFFD where the recogniser gave up, so matching
// took half-tokens for whole ones.
const locateTokens = (
  text: string,
  ids: Array<number>,
  decode: DecodeIds,
): Array<TokenRange | undefined> => {
  const ranges: Array<TokenRange | undefined> = Array.from({ length: ids.length });
  const bounds: Array<number | undefined> = [];
  let decoded = "";

  for (const [index, id] of ids.entries()) {
    if (decode([id]) === "") {
      bounds.push(undefined);
      continue;
    }

    decoded = decode(ids.slice(0, index + 1));
    bounds.push(decoded.length);
  }

  const map = alignToSource(text, decoded);
  let reached = 0;
  let last: TokenRange | undefined;

  for (const [index, bound] of bounds.entries()) {
    if (bound === undefined) {
      continue;
    }

    // No growth means the tokenizer split one character across several tokens, and a
    // label on either part has to cover all of it.
    if (bound <= reached) {
      ranges[index] = last;
      continue;
    }

    // Bounded by the token's own characters rather than by where the previous one
    // stopped, so a dropped character falls outside both rather than being masked.
    last = {
      end: wholeCharacter(text, map[bound - 1] + 1),
      start: startOfCharacter(text, map[reached]),
    };
    ranges[index] = last;
    reached = bound;
  }

  return ranges;
};

export { locateTokens };
export type { DecodeIds, TokenRange };

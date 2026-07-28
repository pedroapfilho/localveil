type TokenRange = { end: number; start: number };

type DecodeIds = (ids: Array<number>) => string;

// Anything above this is written as a surrogate pair, so a code point read at the
// position before a boundary being astral means the boundary splits that pair.
const ASTRAL = 0x1_00_00;

// A boundary between the two halves of a pair would let a span start or end on half
// a character, so an end is nudged past the pair and a start back to the front of it.
const wholeCharacter = (text: string, at: number) =>
  at > 0 && at < text.length && (text.codePointAt(at - 1) ?? 0) >= ASTRAL ? at + 1 : at;

const startOfCharacter = (text: string, at: number) =>
  at > 0 && (text.codePointAt(at - 1) ?? 0) >= ASTRAL ? at - 1 : at;

// The tokenizer does not always give back what it was handed: a space in front of a
// comma comes back missing, and an invoice with 88 of them lost one. Offsets counted
// in what came out would sit one character to the left of the text from there on, so
// the two are walked together and every decoded position is mapped to the source
// position it came from.
//
// Deletions are fine, and the map absorbs them. A substitution is not: the walk runs
// off the end of the source and throws rather than placing spans against a string
// that is quietly different from the one the reader gave us.
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

// The token-classification pipeline leaves `start` and `end` unset: it decodes each
// id on its own and has no offset mapping to consult, because this model ships a
// slow tokenizer. Offsets are rebuilt here.
//
// Not by matching decoded tokens against the text, which is what this used to do.
// Decoding one token of a character that spans several produces U+FFFD, and OCR of a
// scanned page is full of literal U+FFFD where the recogniser gave up. The two are
// the same character, so the match could take a half-token for a whole one, drift by
// a character, and then fail on a page that was perfectly readable.
//
// Instead each token's end is read off the length of everything decoded up to it,
// then mapped back onto the source. Decoding is a homomorphism over the byte stream,
// so that prefix is exactly the text so far, whatever the bytes happen to be.
const locateTokens = (
  text: string,
  ids: Array<number>,
  decode: DecodeIds,
): Array<TokenRange | undefined> => {
  const ranges: Array<TokenRange | undefined> = Array.from({ length: ids.length });
  const bounds: Array<number | undefined> = [];
  let decoded = "";

  for (const [index, id] of ids.entries()) {
    // Special tokens decode to nothing and take up no room in the text.
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

    // No growth means this token is one part of a character the tokenizer split
    // across several: the whole character is already covered by the range before it,
    // and a label on either part has to cover all of it.
    if (bound <= reached) {
      ranges[index] = last;
      continue;
    }

    // Bounded by the token's own first and last characters rather than by where the
    // one before it stopped, so a character the tokenizer dropped in between falls
    // outside both instead of being masked with whichever neighbour claimed it.
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

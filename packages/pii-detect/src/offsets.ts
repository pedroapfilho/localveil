type TokenRange = { end: number; start: number };

type DecodeIds = (ids: Array<number>) => string;

// Anything above this is written as a surrogate pair, so a code point read at the
// position before a boundary being astral means the boundary splits that pair.
const ASTRAL = 0x1_00_00;

// A boundary between the two halves of a pair would let a span start or end on half
// a character, so it is nudged past it.
const wholeCharacter = (text: string, at: number) =>
  at > 0 && at < text.length && (text.codePointAt(at - 1) ?? 0) >= ASTRAL ? at + 1 : at;

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
// Instead each token's end is read off the length of everything decoded up to it.
// Decoding is a homomorphism over the byte stream, so that prefix is exactly the
// text so far, whatever the bytes happen to be.
const locateTokens = (
  text: string,
  ids: Array<number>,
  decode: DecodeIds,
): Array<TokenRange | undefined> => {
  const ranges: Array<TokenRange | undefined> = Array.from({ length: ids.length });
  let cursor = 0;
  let whole = "";

  for (const [index, id] of ids.entries()) {
    // Special tokens decode to nothing and take up no room in the text.
    if (decode([id]) === "") {
      continue;
    }

    whole = decode(ids.slice(0, index + 1));

    const upto = wholeCharacter(text, whole.length);

    // No growth means this token is one part of a character the tokenizer split
    // across several: the whole character is already covered by the range before it,
    // and a label on either part has to cover all of it.
    if (upto <= cursor) {
      ranges[index] = ranges[index - 1];
      continue;
    }

    ranges[index] = { end: upto, start: cursor };
    cursor = upto;
  }

  // The offsets describe what the tokenizer round-trips to. If that is not the text
  // it was given, every span would be placed against the wrong string, and a
  // redaction in the wrong place is worse than none.
  if (whole !== text) {
    throw new Error(
      `The tokenizer round-tripped ${String(whole.length)} characters of a ${String(text.length)}-character chunk, so no span can be placed`,
    );
  }

  return ranges;
};

export { locateTokens };
export type { DecodeIds, TokenRange };

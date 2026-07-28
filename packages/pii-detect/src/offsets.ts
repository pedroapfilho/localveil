type TokenRange = { end: number; start: number };

type DecodeIds = (ids: Array<number>) => string;

// The token-classification pipeline leaves `start` and `end` unset: it decodes each
// id on its own and has no offset mapping to consult, because this model ships a
// slow tokenizer. Offsets are rebuilt here by replaying the decoded tokens against
// the text they came from.
const locateTokens = (
  text: string,
  ids: Array<number>,
  decode: DecodeIds,
): Array<TokenRange | undefined> => {
  const ranges: Array<TokenRange | undefined> = Array.from({ length: ids.length });
  let cursor = 0;
  let index = 0;

  while (index < ids.length) {
    // Special tokens decode to nothing and take up no room in the text.
    if (decode([ids[index]]) === "") {
      index += 1;
      continue;
    }

    let last = index;
    let piece = decode([ids[index]]);

    // A character whose bytes straddle two tokens decodes to replacement characters
    // until the whole byte sequence is decoded in one go, so the group grows until
    // it lines up with the text again.
    while (!text.startsWith(piece, cursor) && last + 1 < ids.length) {
      last += 1;
      piece = decode(ids.slice(index, last + 1));
    }

    if (!text.startsWith(piece, cursor)) {
      throw new Error(
        `Token ${String(index)} decoded to ${JSON.stringify(piece)}, which is not what the text holds at ${String(cursor)}`,
      );
    }

    const range = { end: cursor + piece.length, start: cursor };

    // Every token in a straddling group points at the character they spell out
    // together; a label on either half covers the whole character.
    for (let member = index; member <= last; member += 1) {
      ranges[member] = range;
    }

    cursor = range.end;
    index = last + 1;
  }

  return ranges;
};

export { locateTokens };
export type { DecodeIds, TokenRange };

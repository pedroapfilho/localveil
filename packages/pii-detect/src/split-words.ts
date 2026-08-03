type SourceWord = { end: number; start: number; text: string };

const WORD = /[\p{L}\p{N}_]+(?:[\-_][\p{L}\p{N}_]+)*|\S/gv;

const splitWords = (text: string): Array<SourceWord> => {
  const words: Array<SourceWord> = [];

  for (const match of text.matchAll(WORD)) {
    words.push({ end: match.index + match[0].length, start: match.index, text: match[0] });
  }

  return words;
};

export { splitWords };
export type { SourceWord };

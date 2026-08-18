import type { SpanWord } from "./gliner-encode.ts";
import type { SourceWord } from "./split-words.ts";

const RUN_OF_CAPITALS = /\p{Lu}{2,}(?:['’]\p{Lu}+)?/gv;

const SHOUTED = /\p{Lu}{2,}(?:['’]\p{Lu}+)?[^\p{Letter}\p{Number}]{1,3}\p{Lu}{2,}/v;

type Segment = { at: number; end: number; start: number };

type Shouting = { segments: Array<Segment>; text: string };

const titleCased = (text: string) =>
  text.replaceAll(RUN_OF_CAPITALS, (word) => word[0] + word.slice(1).toLowerCase());

const collectShouting = (text: string): Shouting => {
  const segments: Array<Segment> = [];
  const lines: Array<string> = [];
  let source = 0;
  let joined = 0;

  for (const line of text.split("\n")) {
    const recased = SHOUTED.test(line) ? titleCased(line) : line;

    if (recased !== line && recased.length === line.length) {
      segments.push({ at: source, end: joined + recased.length, start: joined });
      lines.push(recased);
      joined += recased.length + 1;
    }

    source += line.length + 1;
  }

  return { segments, text: lines.join("\n") };
};

const positionShouted = (
  words: Array<SourceWord>,
  segments: Array<Segment>,
  base: number,
): Array<SpanWord> => {
  const positioned: Array<SpanWord> = [];
  let line = 0;

  for (const word of words) {
    while (line < segments.length && word.start >= segments[line].end) {
      line += 1;
    }

    const segment = segments[line];

    if (segment === undefined || word.start < segment.start) {
      continue;
    }

    const shift = segment.at - segment.start + base;

    positioned.push({
      end: Math.min(word.end, segment.end) + shift,
      line,
      start: word.start + shift,
      text: word.text,
    });
  }

  return positioned;
};

export { collectShouting, positionShouted, titleCased };
export type { Segment, Shouting };

import type { Span } from "@repo/redact-core";

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

const toSourceSpans = (spans: Array<Span>, segments: Array<Segment>): Array<Span> => {
  const mapped: Array<Span> = [];

  for (const segment of segments) {
    const shift = segment.at - segment.start;

    for (const span of spans) {
      if (span.start >= segment.start && span.start < segment.end) {
        mapped.push({
          ...span,
          end: Math.min(span.end, segment.end) + shift,
          start: span.start + shift,
        });
      }
    }
  }

  return mapped;
};

export { collectShouting, titleCased, toSourceSpans };
export type { Segment, Shouting };

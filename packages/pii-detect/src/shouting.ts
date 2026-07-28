import type { Span } from "@repo/redact-core";

// Named-entity models lean on capitalisation so heavily that recall collapses without
// it: a shouted invoice header went undetected at every threshold, while the same text
// in title case was tagged at once. A line with no capitals reads identically either
// way, so only the shouted lines are worth a second pass.
const RUN_OF_CAPITALS = /\p{Lu}{2,}(?:['’]\p{Lu}+)?/gv;

// Two capitalised words in a row. One alone is an acronym far more often than a name,
// and INFO on every line of a log would send the whole file through twice.
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

    // U+0130 lowercases to two code units. A line that changed length would put every
    // offset after it one place out.
    if (recased !== line && recased.length === line.length) {
      segments.push({ at: source, end: joined + recased.length, start: joined });
      lines.push(recased);
      joined += recased.length + 1;
    }

    source += line.length + 1;
  }

  return { segments, text: lines.join("\n") };
};

// A span the model runs across the join between two lines is an artefact of standing
// them side by side, so it is cut back to the line it started on.
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

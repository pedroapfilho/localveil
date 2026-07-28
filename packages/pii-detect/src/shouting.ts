import type { Span } from "@repo/redact-core";

// Named-entity models lean on capitalisation so heavily that recall collapses when
// it is gone: an invoice header reading PEDRO AFONSO PEDROSA FILHO went undetected at
// every threshold, while the same text in title case was tagged immediately. So the
// shouting gets read a second time in a case the model can work with.
//
// Only the shouting, though. A line with no run of capitals reads identically in both
// passes, so anything on it was already found the first time, and recasing the whole
// chunk to reach one header meant classifying the entire document twice.
const RUN_OF_CAPITALS = /\p{Lu}{2,}(?:['’]\p{Lu}+)?/gv;

// Two capitalised words in a row. One on its own is an acronym far more often than a
// name: INFO, WARN, CPF and PDF all trip a single run, and a log file trips it on
// every line.
const SHOUTED = /\p{Lu}{2,}(?:['’]\p{Lu}+)?[^\p{Letter}\p{Number}]{1,3}\p{Lu}{2,}/v;

// Where one line of the second pass came from. `at` is its start in the source, and
// `start`/`end` bound it in the joined text the model is handed.
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

    // Case is length-preserving for almost every letter, but not all of them: U+0130
    // lowercases to two code units. A line that changed length would put every offset
    // after it one place out, so it is left to the first pass.
    if (recased !== line && recased.length === line.length) {
      segments.push({ at: source, end: joined + recased.length, start: joined });
      lines.push(recased);
      joined += recased.length + 1;
    }

    source += line.length + 1;
  }

  return { segments, text: lines.join("\n") };
};

// The second pass sees lines that may be pages apart in the document. A span the
// model runs across the join between two of them is an artefact of standing them
// side by side, so it is cut back to the line it started on.
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

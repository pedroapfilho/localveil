import type { PiiLabel, Span } from "@repo/redact-core";

import { labelForField } from "./field-labels.ts";

type Cell = { end: number; start: number; value: string };

const DELIMITERS = [",", ";", "\t"] as const;

const countOutsideQuotes = (line: string, delimiter: string) => {
  let count = 0;
  let quoted = false;

  for (const character of line) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === delimiter && !quoted) {
      count += 1;
    }
  }

  return count;
};

const pickDelimiter = (header: string) =>
  DELIMITERS.reduce((best, candidate) =>
    countOutsideQuotes(header, candidate) > countOutsideQuotes(header, best) ? candidate : best,
  );

const splitRow = (text: string, from: number, to: number, delimiter: string): Array<Cell> => {
  const cells: Array<Cell> = [];
  let start = from;
  let quoted = false;

  for (let at = from; at < to; at += 1) {
    const character = text[at];

    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === delimiter && !quoted) {
      cells.push({ end: at, start, value: text.slice(start, at) });
      start = at + 1;
    }
  }

  cells.push({ end: to, start, value: text.slice(start, to) });

  return cells;
};

const trimmed = ({ end, start, value }: Cell): Cell => {
  const lead = value.length - value.trimStart().length;
  const tail = value.length - value.trimEnd().length;
  const inner = value.slice(lead, value.length - tail);

  if (inner.length >= 2 && inner.startsWith('"') && inner.endsWith('"')) {
    return { end: end - tail - 1, start: start + lead + 1, value: inner.slice(1, -1) };
  }

  return { end: end - tail, start: start + lead, value: inner };
};

const lineRanges = (text: string) => {
  const ranges: Array<{ end: number; start: number }> = [];
  let start = 0;

  for (let at = 0; at <= text.length; at += 1) {
    if (at === text.length || text[at] === "\n") {
      const end = at > start && text[at - 1] === "\r" ? at - 1 : at;

      if (end > start) {
        ranges.push({ end, start });
      }

      start = at + 1;
    }
  }

  return ranges;
};

const csvFieldSpans = (text: string): Array<Span> => {
  const rows = lineRanges(text);
  const header = rows.at(0);

  if (header === undefined || rows.length < 2) {
    return [];
  }

  const delimiter = pickDelimiter(text.slice(header.start, header.end));
  const columns = splitRow(text, header.start, header.end, delimiter).map(
    (cell): PiiLabel | undefined => labelForField(trimmed(cell).value),
  );

  if (!columns.some((label) => label !== undefined)) {
    return [];
  }

  return rows.slice(1).flatMap((row) =>
    splitRow(text, row.start, row.end, delimiter).flatMap((cell, at) => {
      const label = columns[at];
      const value = trimmed(cell);

      if (label === undefined || value.value.trim().length === 0) {
        return [];
      }

      return [{ end: value.end, label, score: 1, start: value.start }];
    }),
  );
};

export { csvFieldSpans };

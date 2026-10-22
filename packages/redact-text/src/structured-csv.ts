import type { PiiLabel, Span } from "@repo/redact-core";

import { labelForField } from "./field-labels";

type Cell = { end: number; start: number; value: string };

type Row = { cells: Array<Cell>; end: number };

const DELIMITERS = [",", ";", "\t"] as const;

const cellAt = (text: string, from: number, to: number): Cell => {
  const raw = text.slice(from, to);
  const start = from + raw.length - raw.trimStart().length;
  const end = to - (raw.length - raw.trimEnd().length);
  const quoted = end - start >= 2 && text[start] === '"' && text[end - 1] === '"';
  const innerStart = quoted ? start + 1 : start;
  const innerEnd = quoted ? end - 1 : end;

  return {
    end: innerEnd,
    start: innerStart,
    value: text.slice(innerStart, innerEnd).replaceAll('""', '"'),
  };
};

const csvRows = function* (text: string, delimiter: string): Generator<Row, void> {
  const field = new RegExp(
    String.raw`(?:[^\S${delimiter}\r\n]*"(?:[^"]|"")*"[^\S${delimiter}\r\n]*|[^"${delimiter}\r\n]*)(?<separator>${delimiter}|\r\n|[\r\n]|$)`,
    "gyv",
  );

  let cells: Array<Cell> = [];

  for (const match of text.matchAll(field)) {
    if (match[0].length === 0 && cells.length === 0) {
      break;
    }

    const separator = match.groups?.separator ?? "";
    const end = match.index + match[0].length;

    cells.push(cellAt(text, match.index, end - separator.length));

    if (separator === delimiter) {
      continue;
    }

    if (cells.some((cell) => cell.value.length > 0)) {
      yield { cells, end };
    }

    cells = [];
  }
};

const pickDelimiter = (text: string) => {
  const candidates = DELIMITERS.map((delimiter) => ({
    columns: csvRows(text, delimiter).next().value?.cells.length ?? 0,
    delimiter,
  }));

  return candidates.reduce((best, candidate) =>
    candidate.columns > best.columns ? candidate : best,
  ).delimiter;
};

const csvFieldSpans = (text: string): Array<Span> => {
  const rows = csvRows(text, pickDelimiter(text));
  const header = rows.next().value;

  if (header === undefined) {
    return [];
  }

  const columns = header.cells.map((cell): PiiLabel | undefined => labelForField(cell.value));
  const spans: Array<Span> = [];

  for (const row of rows) {
    row.cells.forEach((cell, at) => {
      const label = columns[at];

      if (label !== undefined && cell.value.trim().length > 0) {
        spans.push({ end: cell.end, label, score: 1, start: cell.start });
      }
    });
  }

  return spans;
};

const csvBody = (text: string) => {
  const header = csvRows(text, pickDelimiter(text)).next().value;

  return header === undefined ? "" : text.slice(header.end);
};

export { csvBody, csvFieldSpans };

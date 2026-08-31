import type { Span } from "@repo/redact-core";

import { labelForField } from "./field-labels";

const PAIR = /"(?<key>(?:[^"\\]|\\.)*)"\s*:\s*(?<value>"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/dgv;

const jsonFieldSpans = (text: string): Array<Span> => {
  const spans: Array<Span> = [];

  for (const match of text.matchAll(PAIR)) {
    const key = match.groups?.key;
    const range = match.indices?.groups?.value;

    if (key === undefined || range === undefined) {
      continue;
    }

    const label = labelForField(key);

    if (label === undefined) {
      continue;
    }

    const quoted = text[range[0]] === '"';
    const start = quoted ? range[0] + 1 : range[0];
    const end = quoted ? range[1] - 1 : range[1];

    if (end > start) {
      spans.push({ end, label, score: 1, start });
    }
  }

  return spans;
};

export { jsonFieldSpans };

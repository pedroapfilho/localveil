import type { PiiLabel, Span } from "@repo/redact-core";

import { labelForField } from "./field-labels";

const TOKEN =
  /"(?:[^"\\]|\\.)*"(?:\s*:)?|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+\-]?\d+)?|true|false|null|[\{\}\[\],]/gv;

const jsonTokens = (text: string) => {
  try {
    JSON.parse(text);

    return text.matchAll(TOKEN);
  } catch {
    return [];
  }
};

const labelForKeyToken = (raw: string) => {
  const key: unknown = JSON.parse(raw.slice(0, -1));

  return typeof key === "string" ? labelForField(key) : undefined;
};

const jsonFieldSpans = (text: string): Array<Span> => {
  const spans: Array<Span> = [];
  let label: PiiLabel | undefined;

  for (const token of jsonTokens(text)) {
    const raw = token[0];

    if (raw.endsWith(":")) {
      label = labelForKeyToken(raw);
      continue;
    }

    if (label !== undefined && (raw.startsWith('"') || /^-?\d/v.test(raw))) {
      const quote = raw.startsWith('"') ? 1 : 0;
      const start = token.index + quote;
      const end = token.index + raw.length - quote;

      if (end > start) {
        spans.push({ end, label, score: 1, start });
      }
    }

    label = undefined;
  }

  return spans;
};

export { jsonFieldSpans };

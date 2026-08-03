import type { PiiLabel, Span } from "./types.ts";

type PiiToken = { label: PiiLabel; score: number; text: string };

const MIN_LENGTH = 3;

const TOKEN = /[\p{Letter}\p{Number}][\p{Letter}\p{Number}._@+\-]*/gv;

const BOUNDARY = String.raw`[\p{Letter}\p{Number}]`;

const escapeForRegExp = (value: string) =>
  value.replaceAll(/[$*+.?^\\\/\(\)\[\]\{\|\}]/gv, String.raw`\$&`);

const tokensFromSpans = (text: string, spans: Array<Span>): Array<PiiToken> => {
  const byText = new Map<string, PiiToken>();

  for (const span of spans) {
    for (const [token] of text.slice(span.start, span.end).matchAll(TOKEN)) {
      if (token.length < MIN_LENGTH) {
        continue;
      }

      byText.set(token.toLowerCase(), { label: span.label, score: span.score, text: token });
    }
  }

  return [...byText.values()];
};

const PATTERNS = new Map<string, RegExp>();

const patternFor = (token: string) => {
  const cached = PATTERNS.get(token);

  if (cached !== undefined) {
    return cached;
  }

  const pattern = new RegExp(`(?<!${BOUNDARY})${escapeForRegExp(token)}(?!${BOUNDARY})`, "giv");

  PATTERNS.set(token, pattern);

  return pattern;
};

const spansForTokens = (text: string, tokens: Array<PiiToken>): Array<Span> => {
  const found = new Map<string, Span>();

  for (const token of tokens) {
    const pattern = patternFor(token.text);

    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;

      found.set(`${String(start)}-${String(end)}`, {
        end,
        label: token.label,
        score: token.score,
        start,
      });
    }
  }

  return [...found.values()].toSorted((left, right) => left.start - right.start);
};

export { spansForTokens, tokensFromSpans };
export type { PiiToken };

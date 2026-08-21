import { APPLY_SCORE } from "./detections.ts";
import type { PiiLabel, Span } from "./types.ts";

type PiiToken = { label: PiiLabel; score: number; text: string };

const MIN_LENGTH = 3;

const BOUNDARY = String.raw`[\p{Letter}\p{Number}]`;

const escapeForRegExp = (value: string) =>
  value.replaceAll(/[$*+.?^\\\/\(\)\[\]\{\|\}]/gv, String.raw`\$&`);

const normalise = (value: string) => value.trim().replaceAll(/\s+/gv, " ");

/* Only whole spans travel. Splitting one into words used to let a weak multi-word tag donate its
   filler: a 0.49 "the addresses set forth at the end of this Agreement" turned "the" into a
   document-wide detection, hundreds of hits per contract. */
const tokensFromSpans = (text: string, spans: Array<Span>): Array<PiiToken> => {
  const byText = new Map<string, PiiToken>();

  for (const span of spans) {
    const phrase = normalise(text.slice(span.start, span.end));

    if (span.score < APPLY_SCORE || phrase.length < MIN_LENGTH) {
      continue;
    }

    const key = phrase.toLowerCase();
    const existing = byText.get(key);

    if (existing === undefined || existing.score < span.score) {
      byText.set(key, { label: span.label, score: span.score, text: phrase });
    }
  }

  return [...byText.values()];
};

const patternFor = (token: string) =>
  new RegExp(
    `(?<!${BOUNDARY})${token
      .split(" ")
      .map(escapeForRegExp)
      .join(String.raw`\s+`)}(?!${BOUNDARY})`,
    "giv",
  );

const spansForTokens = (text: string, tokens: Array<PiiToken>): Array<Span> => {
  const found = new Map<string, Span>();

  for (const token of tokens) {
    for (const match of text.matchAll(patternFor(token.text))) {
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

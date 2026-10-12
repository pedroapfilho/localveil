import { normalise } from "./text";
import type { DetectedText, Span } from "./types";

const QUOTE = String.raw`["“”]`;

const ARTICLE = String.raw`(?:the\s+|each,?\s+(?:an?\s+)?|an?\s+)?`;

const DEFINITION = new RegExp(
  String.raw`\(\s*${ARTICLE}${QUOTE}\s*(?<term>[^"“”\(\)]{2,60}?)\s*${QUOTE}\s*\)`,
  "giv",
);

const ALIAS_WINDOW = 80;

/* Matches the same three languages patterns.ts writes its month names in. */
const LEADING_ARTICLE = /^(?:the|an?|os?|as|un[ao]?|el|l[ao]s?)\s+/iv;

const folded = (value: string) => normalise(value).toLowerCase();

const asTerm = (value: string) => folded(value).replace(LEADING_ARTICLE, "");

const holdsWord = (haystack: string, word: string) =>
  new RegExp(String.raw`(?<![\p{Letter}\p{Number}])${word}(?![\p{Letter}\p{Number}])`, "iv").test(
    haystack,
  );

/* A contract names a party by role, Zora Labs, Inc. ("Client"), but a person can be aliased the
   same way: Pedro Filho ("Pedro"). Suppressing the second would leak every bare mention of the
   name, so a term buried inside longer PII detected just before the bracket stays a detection.
   The term must be a real fragment of that PII: a role arises from the contract's own wording,
   "Consultant" on a signature page, and the model tags that wording too. */
const aliasesDetected = (text: string, spans: ReadonlyArray<Span>, at: number, term: string) => {
  const from = Math.max(0, at - ALIAS_WINDOW);

  return spans.some((span) => {
    if (span.end <= from || span.start >= at) {
      return false;
    }

    const tagged = text.slice(span.start, span.end);

    return folded(tagged) !== folded(term) && holdsWord(tagged, term);
  });
};

const definedTerms = (units: ReadonlyArray<DetectedText>): Set<string> => {
  const terms = new Set<string>();

  for (const { spans, text } of units) {
    for (const match of text.matchAll(DEFINITION)) {
      const term = match.groups?.term;

      if (term === undefined || aliasesDetected(text, spans, match.index, term)) {
        continue;
      }

      terms.add(folded(term));
    }
  }

  return terms;
};

const dropDefinedTerms = (
  spans: ReadonlyArray<Span>,
  text: string,
  terms: ReadonlySet<string>,
): Array<Span> =>
  terms.size === 0
    ? [...spans]
    : spans.filter((span) => !terms.has(asTerm(text.slice(span.start, span.end))));

export { definedTerms, dropDefinedTerms };

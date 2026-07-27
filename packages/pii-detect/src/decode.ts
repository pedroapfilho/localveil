import type { PiiLabel, Span } from "@repo/redact-core";

import { isPiiLabel } from "./labels.ts";

type RawToken = { end: number; entity: string; score: number; start: number };

type Tag = { label: PiiLabel; prefix: string };

const TAG_PREFIXES = new Set(["B", "E", "I", "S"]);

const parseTag = (entity: string): Tag | undefined => {
  if (entity === "O") {
    return undefined;
  }

  const dash = entity.indexOf("-");
  const prefix = entity.slice(0, dash);
  const label = entity.slice(dash + 1);

  if (dash === -1 || !TAG_PREFIXES.has(prefix) || !isPiiLabel(label)) {
    throw new TypeError(`Unrecognised BIOES tag "${entity}" from the token classifier`);
  }

  return { label, prefix };
};

const assertOffsets = (token: RawToken) => {
  if (!Number.isFinite(token.start) || !Number.isFinite(token.end)) {
    throw new TypeError(
      `Token "${token.entity}" carries no character offsets; the tokenizer must be run with offset mapping`,
    );
  }
};

const decodeBioes = (tokens: Array<RawToken>, minScore: number): Array<Span> => {
  const spans: Array<Span> = [];
  let open: Span | undefined;

  const close = () => {
    if (open !== undefined) {
      spans.push(open);
      open = undefined;
    }
  };

  for (const token of tokens) {
    const tag = parseTag(token.entity);

    if (tag === undefined || token.score < minScore) {
      close();
      continue;
    }

    assertOffsets(token);

    const previous = open;

    // An I- or E- that follows nothing, or follows a different label, is a
    // mislabelled sequence rather than noise to drop: open a span at it anyway so
    // the text still gets covered.
    if (previous !== undefined && previous.label === tag.label && tag.prefix !== "B") {
      open = { ...previous, end: token.end, score: Math.min(previous.score, token.score) };
    } else {
      close();
      open = { end: token.end, label: tag.label, score: token.score, start: token.start };
    }

    if (tag.prefix === "E" || tag.prefix === "S") {
      close();
    }
  }

  close();

  return spans;
};

export { decodeBioes };
export type { RawToken };

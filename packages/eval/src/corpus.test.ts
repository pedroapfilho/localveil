import type { PiiLabel } from "@repo/redact-core";
import { patternSpans } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import { loadCorpus, parseMarked } from "./corpus.ts";

const LABELS: Array<PiiLabel> = [
  "account_number",
  "private_address",
  "private_date",
  "private_email",
  "private_person",
  "private_phone",
  "private_url",
  "secret",
];

const corpus = await loadCorpus();

const isNegative = (id: string) => id.endsWith("negativos") || id.endsWith("negatives");

describe("parseMarked", () => {
  it("strips the markers and places the span where the value landed", () => {
    expect(parseMarked("Hi [[private_person|Ana Lima]]!", "doc")).toEqual({
      spans: [{ end: 11, label: "private_person", start: 3 }],
      text: "Hi Ana Lima!",
    });
  });

  it("keeps offsets right across several marks", () => {
    const { spans, text } = parseMarked(
      "[[private_person|Ana]] wrote to [[private_email|a@b.co]] today",
      "doc",
    );

    expect(text).toBe("Ana wrote to a@b.co today");
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(["Ana", "a@b.co"]);
  });

  it("leaves unmarked text alone", () => {
    expect(parseMarked("nothing here", "doc")).toEqual({ spans: [], text: "nothing here" });
  });

  it("refuses a label it does not know", () => {
    expect(() => parseMarked("[[nickname|Ana]]", "doc")).toThrow(/not a PII label/v);
  });

  it("refuses a mark with nothing in it", () => {
    expect(() => parseMarked("[[private_person|]]", "doc")).toThrow(/empty span/v);
  });
});

describe("the corpus", () => {
  it("holds at least thirty documents", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(30);
  });

  it("holds at least twelve Portuguese documents", () => {
    expect(corpus.filter((document) => document.language === "pt").length).toBeGreaterThanOrEqual(
      12,
    );
  });

  it("covers English and Spanish too", () => {
    expect(corpus.filter((document) => document.language === "en").length).toBeGreaterThanOrEqual(
      9,
    );
    expect(corpus.filter((document) => document.language === "es").length).toBeGreaterThanOrEqual(
      9,
    );
  });

  it("keeps every span inside its own text", () => {
    for (const document of corpus) {
      for (const span of document.spans) {
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.end).toBeLessThanOrEqual(document.text.length);
        expect(span.start).toBeLessThan(span.end);
      }
    }
  });

  it("uses every label at least three times", () => {
    const counted = corpus.flatMap((document) => document.spans);

    for (const label of LABELS) {
      expect(counted.filter((span) => span.label === label).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses every label at least once in Portuguese", () => {
    const counted = corpus
      .filter((document) => document.language === "pt")
      .flatMap((document) => document.spans);

    for (const label of LABELS) {
      expect(counted.filter((span) => span.label === label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("carries negative material with nothing to redact in it", () => {
    const negatives = corpus.filter((document) => isNegative(document.id));

    expect(negatives.length).toBeGreaterThanOrEqual(3);

    for (const document of negatives) {
      expect(document.spans).toEqual([]);
    }
  });

  it("labels everything the pattern layer finds in a document that carries data", () => {
    for (const document of corpus.filter((entry) => !isNegative(entry.id))) {
      for (const span of patternSpans(document.text)) {
        const covered = document.spans.some(
          (want) => want.start < span.end && want.end > span.start,
        );

        expect(
          covered,
          `${document.id} leaves "${document.text.slice(span.start, span.end)}" unlabelled`,
        ).toBe(true);
      }
    }
  });

  it("finds nothing at all in negative material", () => {
    const found = corpus
      .filter((document) => isNegative(document.id))
      .flatMap((document) =>
        patternSpans(document.text).map((span) => document.text.slice(span.start, span.end)),
      );

    expect(found).toEqual([]);
  });
});

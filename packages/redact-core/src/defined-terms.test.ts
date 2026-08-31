import { describe, expect, it } from "vitest";

import { definedTerms, dropDefinedTerms } from "./defined-terms";
import type { Span } from "./types";

const CONTRACT =
  "This Consulting Agreement (the “ Agreement ”) is made between Zora Labs, Inc., " +
  "a Delaware corporation (“ Client ”) and the consultant named on the signature page " +
  "(“ Consultant ”). Client may issue assignments to Consultant (each, a “ Project Assignment ”).";

const person = (start: number, end: number): Span => ({
  end,
  label: "private_person",
  score: 0.97,
  start,
});

const spanOver = (text: string, value: string) => {
  const start = text.indexOf(value);

  return person(start, start + value.length);
};

describe("definedTerms", () => {
  it("collects a term a contract puts in quotes inside brackets", () => {
    expect(definedTerms('The party of record ("Discloser") agrees.', [])).toEqual(
      new Set(["discloser"]),
    );
  });

  it("reads the article a contract writes before the quote", () => {
    expect(definedTerms(CONTRACT, [])).toEqual(
      new Set(["agreement", "client", "consultant", "project assignment"]),
    );
  });

  it("reads curly quotes the way a word processor writes them", () => {
    expect(definedTerms("a Delaware corporation (“ Client ”)", [])).toEqual(new Set(["client"]));
  });

  it("ignores brackets that hold no quoted term", () => {
    expect(definedTerms("Payment is due (within 30 days) after invoice.", [])).toEqual(new Set());
  });

  it("finds nothing in a document that defines nothing", () => {
    expect(definedTerms("Pedro Filho paid R$ 100 to Blue Village on 20/08/2026.", [])).toEqual(
      new Set(),
    );
  });

  it("leaves a term alone when it shortens the name just detected before it", () => {
    const text = 'Pedro Filho ("Pedro") will consult.';

    expect(definedTerms(text, [spanOver(text, "Pedro Filho")])).toEqual(new Set());
  });

  it("takes a role even when a detected name sits right before it", () => {
    const text = 'Pedro Filho ("Consultant") will consult.';

    expect(definedTerms(text, [spanOver(text, "Pedro Filho")])).toEqual(new Set(["consultant"]));
  });

  it("takes a role a contract defines out of its own lowercase word", () => {
    const text = 'the consultant named on the signature page ("Consultant") agrees';

    expect(definedTerms(text, [spanOver(text, "consultant")])).toEqual(new Set(["consultant"]));
  });

  it("takes a role defined after a company the model tagged", () => {
    const text = 'Zora Labs, Inc., a Delaware corporation ("Client") engages the consultant.';

    expect(definedTerms(text, [spanOver(text, "Zora Labs, Inc.")])).toEqual(new Set(["client"]));
  });
});

describe("dropDefinedTerms", () => {
  const TERMS = definedTerms(CONTRACT, []);

  it("drops a detection that only repeats a defined term", () => {
    const text = "Consultant will invoice Client monthly.";

    expect(dropDefinedTerms([person(0, 10), person(24, 30)], text, TERMS)).toEqual([]);
  });

  it("keeps a real name that shares a page with defined terms", () => {
    const text = "Consultant is Pedro Filho.";

    expect(
      dropDefinedTerms([person(0, 10), spanOver(text, "Pedro Filho")], text, TERMS).map(
        ({ end, start }) => text.slice(start, end),
      ),
    ).toEqual(["Pedro Filho"]);
  });

  it("drops a defined term the model tagged along with its article", () => {
    const text = "The Recipient will return the materials.";

    expect(dropDefinedTerms([person(0, 13)], text, new Set(["recipient"]))).toEqual([]);
  });

  it("keeps a name that merely follows a defined term", () => {
    const text = "the Recipient Ana Lima signed.";

    expect(dropDefinedTerms([person(0, 22)], text, new Set(["recipient"]))).toHaveLength(1);
  });

  it("matches a term however the document cased it", () => {
    const text = "the CONSULTANT agrees";

    expect(dropDefinedTerms([person(4, 14)], text, TERMS)).toEqual([]);
  });

  it("keeps every detection when the document defined no terms", () => {
    const text = "Consultant will invoice Client monthly.";

    expect(dropDefinedTerms([person(0, 10)], text, new Set())).toHaveLength(1);
  });
});

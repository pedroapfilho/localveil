import { describe, expect, it } from "vitest";

import { csvFieldSpans } from "./structured-csv.ts";

const covered = (text: string) =>
  csvFieldSpans(text).map((span) => `${span.label}:${text.slice(span.start, span.end)}`);

describe("csvFieldSpans", () => {
  it("covers every cell under a column it recognises", () => {
    expect(covered("nome,sku\nAna Lima,X-1\nJoao Reis,X-2")).toEqual([
      "private_person:Ana Lima",
      "private_person:Joao Reis",
    ]);
  });

  it("leaves the header itself readable", () => {
    const text = "nome,sku\nAna Lima,X-1";
    const [span] = csvFieldSpans(text);

    expect(span.start).toBeGreaterThan(text.indexOf("\n"));
  });

  it("covers several columns at once", () => {
    expect(covered("nome,email,sku\nAna,a@b.co,X-1")).toEqual([
      "private_person:Ana",
      "private_email:a@b.co",
    ]);
  });

  it("covers a postcode column but leaves a bare city alone", () => {
    expect(covered("nome,cep,cidade\nAna Lima,50030-230,Recife")).toEqual([
      "private_person:Ana Lima",
      "private_address:50030-230",
    ]);
  });

  it("finds the delimiter rather than assuming a comma", () => {
    expect(covered("nome;sku\nAna Lima;X-1")).toEqual(["private_person:Ana Lima"]);
    expect(covered("nome\tsku\nAna Lima\tX-1")).toEqual(["private_person:Ana Lima"]);
  });

  it("keeps a delimiter inside quotes out of the split", () => {
    expect(covered('nome,sku\n"Lima, Ana",X-1')).toEqual(["private_person:Lima, Ana"]);
  });

  it("covers the value inside the quotes rather than the quotes", () => {
    expect(covered('nome\n"Ana Lima"')).toEqual(["private_person:Ana Lima"]);
  });

  it("trims the padding around a cell", () => {
    expect(covered("nome, sku\n Ana Lima , X-1")).toEqual(["private_person:Ana Lima"]);
  });

  it("says nothing about an empty cell", () => {
    expect(covered("nome,sku\n,X-1\nAna,X-2")).toEqual(["private_person:Ana"]);
  });

  it("says nothing when no column is recognised", () => {
    expect(csvFieldSpans("sku,qty\nX-1,4")).toEqual([]);
  });

  it("says nothing about a file with only a header", () => {
    expect(csvFieldSpans("nome,sku")).toEqual([]);
  });

  it("says nothing about an empty file", () => {
    expect(csvFieldSpans("")).toEqual([]);
  });

  it("survives carriage returns", () => {
    expect(covered("nome,sku\r\nAna Lima,X-1\r\n")).toEqual(["private_person:Ana Lima"]);
  });

  it("ignores a row with fewer cells than the header", () => {
    expect(covered("nome,email\nAna\nJoao,j@b.co")).toEqual([
      "private_person:Ana",
      "private_person:Joao",
      "private_email:j@b.co",
    ]);
  });
});

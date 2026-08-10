import { describe, expect, it } from "vitest";

import { jsonFieldSpans } from "./structured-json.ts";

const covered = (text: string) =>
  jsonFieldSpans(text).map((span) => `${span.label}:${text.slice(span.start, span.end)}`);

describe("jsonFieldSpans", () => {
  it("covers the value under a key it recognises", () => {
    expect(covered('{"nome": "Ana Lima", "sku": "X-1"}')).toEqual(["private_person:Ana Lima"]);
  });

  it("leaves the key itself readable", () => {
    const text = '{"nome": "Ana Lima"}';
    const [span] = jsonFieldSpans(text);

    expect(text.slice(span.start, span.end)).toBe("Ana Lima");
    expect(text.slice(0, span.start)).toContain("nome");
  });

  it("covers the value rather than its quotes", () => {
    const text = '{"email": "a@b.co"}';

    expect(covered(text)).toEqual(["private_email:a@b.co"]);
    expect(text[jsonFieldSpans(text)[0].start - 1]).toBe('"');
  });

  it("reads the identifier and credential keys", () => {
    expect(covered('{"cpf": "529.982.247-25", "senha": "hunter2"}')).toEqual([
      "account_number:529.982.247-25",
      "secret:hunter2",
    ]);
  });

  it("covers a numeric value too", () => {
    expect(covered('{"accountNumber": 4532015112830036}')).toEqual([
      "account_number:4532015112830036",
    ]);
  });

  it("reaches keys nested inside objects and arrays", () => {
    expect(covered('{"users": [{"nome": "Ana"}, {"nome": "Joao"}]}')).toEqual([
      "private_person:Ana",
      "private_person:Joao",
    ]);
  });

  it("survives an escaped quote inside a value", () => {
    expect(covered(String.raw`{"nome": "Ana \"Aninha\" Lima"}`)).toEqual([
      String.raw`private_person:Ana \"Aninha\" Lima`,
    ]);
  });

  it("says nothing about an empty value", () => {
    expect(jsonFieldSpans('{"nome": ""}')).toEqual([]);
  });

  it("says nothing about a key it does not know", () => {
    expect(jsonFieldSpans('{"sku": "X-1", "id": 4}')).toEqual([]);
  });

  it("says nothing about text that is not JSON", () => {
    expect(jsonFieldSpans("nome: Ana Lima")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { isCnpj, isCpf, isIban, luhn, patternSpans } from "./patterns.ts";

const covered = (text: string) =>
  patternSpans(text).map(({ end, start }) => text.slice(start, end));

const labels = (text: string) => patternSpans(text).map((span) => span.label);

describe("check digits", () => {
  it("accepts a valid CPF and rejects a near miss", () => {
    expect(isCpf("108.467.036-45")).toBe(true);
    expect(isCpf("108.467.036-46")).toBe(false);
  });

  it("rejects a CPF of one repeated digit, which passes the arithmetic", () => {
    expect(isCpf("111.111.111-11")).toBe(false);
  });

  it("accepts a valid CNPJ and rejects a near miss", () => {
    expect(isCnpj("31.748.174/0006-75")).toBe(true);
    expect(isCnpj("31.748.174/0006-76")).toBe(false);
  });

  it("accepts a valid IBAN and rejects a near miss", () => {
    expect(isIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(isIban("GB82 WEST 1234 5698 7654 33")).toBe(false);
  });

  it("accepts a Luhn-valid card number and rejects a near miss", () => {
    expect(luhn("4111 1111 1111 1111")).toBe(true);
    expect(luhn("4111 1111 1111 1112")).toBe(false);
  });
});

describe("patternSpans", () => {
  it("finds an email", () => {
    expect(covered("write to ana@example.com today")).toEqual(["ana@example.com"]);
  });

  it("finds a formatted CPF", () => {
    expect(covered("CPF: 108.467.036-45")).toEqual(["108.467.036-45"]);
  });

  it("finds a bare CPF, because the check digits vouch for it", () => {
    expect(covered("documento 10846703645 emitido")).toEqual(["10846703645"]);
  });

  it("finds a formatted CNPJ", () => {
    expect(covered("CNPJ 31.748.174/0006-75")).toEqual(["31.748.174/0006-75"]);
  });

  it("finds an IBAN", () => {
    expect(covered("pay GB82WEST12345698765432 please")).toEqual(["GB82WEST12345698765432"]);
  });

  it("finds a card number", () => {
    expect(covered("card 4111 1111 1111 1111 exp")).toEqual(["4111 1111 1111 1111"]);
  });

  it("finds a phone number that carries separators", () => {
    expect(covered("call 555-0181 now")).toEqual(["555-0181"]);
  });

  // An invoice is mostly digits. Blacking out the ones that merely look like an
  // identifier is how a page ends up unreadable.
  it("leaves an eleven-digit number that fails the CPF check alone", () => {
    expect(covered("total 12345678901 units")).toEqual([]);
  });

  it("leaves a card-length number that fails Luhn alone", () => {
    expect(covered("ref 4111111111111112 here")).toEqual([]);
  });

  it("leaves a bare run of digits alone", () => {
    expect(covered("quantity 210 37 units 5432")).toEqual([]);
  });

  it("leaves a plain amount alone", () => {
    expect(covered("RS 210,37 total")).toEqual([]);
  });

  it("labels each kind of match", () => {
    expect(labels("ana@example.com and 108.467.036-45")).toEqual([
      "private_email",
      "account_number",
    ]);
  });

  it("scores a pattern match as certain, because arithmetic is not a guess", () => {
    expect(patternSpans("CPF 108.467.036-45")[0].score).toBe(1);
  });

  it("reports spans in the order they appear", () => {
    const starts = patternSpans("a@b.co then 108.467.036-45").map((span) => span.start);

    expect(starts).toEqual(starts.toSorted((left, right) => left - right));
  });

  it("finds nothing in text that holds nothing", () => {
    expect(patternSpans("just some ordinary prose here")).toEqual([]);
  });
});

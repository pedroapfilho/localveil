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

  it("finds an IBAN printed in the conventional groups of four", () => {
    expect(covered("pay GB82 WEST 1234 5698 7654 32 today")).toEqual([
      "GB82 WEST 1234 5698 7654 32",
    ]);
  });

  it("covers a whole US number once, not also its trailing subscriber number", () => {
    expect(covered("call 555-123-4567 now")).toEqual(["555-123-4567"]);
  });

  it("finds a Brazilian mobile with a bare area code", () => {
    expect(covered("Tel: 11 98765-4321")).toEqual(["11 98765-4321"]);
  });

  it("finds a nine-digit mobile by its leading nine", () => {
    expect(covered("Tel: 98765-4321")).toEqual(["98765-4321"]);
  });

  it("leaves a span of years alone, which is not a telephone", () => {
    expect(covered("operating years 2019-2024 shown")).toEqual([]);
  });

  it("finds an RG beside its label and leaves the label readable", () => {
    expect(covered("RG 12.345.678-9 emitido")).toEqual(["12.345.678-9"]);
    expect(labels("RG 12.345.678-9")).toEqual(["account_number"]);
  });

  it("finds a CNH registration number beside its label", () => {
    expect(covered("Registro 02334567890 valido")).toEqual(["02334567890"]);
  });

  it("leaves a bare eleven-digit run alone without the registration label", () => {
    expect(covered("lote 02334567890 itens")).toEqual([]);
  });

  it("finds a CEP beside its label", () => {
    expect(covered("CEP 01310-100 centro")).toEqual(["01310-100"]);
    expect(labels("CEP 01310-100")).toEqual(["private_address"]);
  });

  it("finds a street address by the word that opens it and the number that closes it", () => {
    expect(covered("mora na Rua Professor Alvaro Rodrigues, 277 Botafogo")).toEqual([
      "Rua Professor Alvaro Rodrigues, 277",
    ]);
    expect(labels("Rua das Acacias, 214")).toEqual(["private_address"]);
  });

  it("finds one written without a comma", () => {
    expect(covered("Avenida Sete de Setembro 1180, Salvador")).toEqual([
      "Avenida Sete de Setembro 1180",
    ]);
  });

  it("finds a Spanish street the same way", () => {
    expect(covered("vive en Calle Alcala 214, Madrid")).toEqual(["Calle Alcala 214"]);
    expect(covered("Paseo de Gracia 45, Barcelona")).toEqual(["Paseo de Gracia 45"]);
  });

  it("reads a street shouted in capitals", () => {
    expect(covered("AVENIDA DE LA CONSTITUCION 88, SEVILLA")).toEqual([
      "AVENIDA DE LA CONSTITUCION 88",
    ]);
  });

  it("leaves a month name alone when the digits after it run longer than a day", () => {
    expect(labels("Sete de Setembro 1180")).not.toContain("private_date");
  });

  it("leaves a street word with no number after it alone", () => {
    expect(covered("a loja fica na Avenida principal do bairro")).toEqual([]);
  });

  it("leaves prose that merely names a road alone", () => {
    expect(covered("seguimos pela Estrada velha ate o fim")).toEqual([]);
  });

  it("finds a written-out date", () => {
    expect(covered("nascido em 12/03/1985 em Santos")).toEqual(["12/03/1985"]);
    expect(labels("12/03/1985")).toEqual(["private_date"]);
  });

  it("leaves an impossible date alone", () => {
    expect(covered("codigo 32/13/1985 interno")).toEqual([]);
  });

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

describe("written dates", () => {
  it("covers a whole English date, not just its year", () => {
    expect(covered("Issued 2 April 2024 by hand")).toContain("2 April 2024");
  });

  it("covers the day and month when no year follows", () => {
    expect(covered("Signed 14 March and filed")).toContain("14 March");
  });

  it("covers a Portuguese date written out", () => {
    expect(covered("Emitida em 14 de março de 2024")).toContain("14 de março de 2024");
  });

  it("covers it without the accent, which OCR often drops", () => {
    expect(covered("Emitida em 14 de marco de 2024")).toContain("14 de marco de 2024");
  });

  it("covers a Spanish date written out", () => {
    expect(covered("Emitida el 2 de abril de 2024")).toContain("2 de abril de 2024");
  });

  it("covers an ordinal day", () => {
    expect(covered("Due 1st April 2024")).toContain("1st April 2024");
  });

  it("covers a month-first date", () => {
    expect(covered("Due April 2, 2024 at noon")).toContain("April 2, 2024");
  });

  it("leaves a bare month alone", () => {
    expect(covered("Every April we review the terms")).toEqual([]);
  });
});

describe("references that look like phone numbers", () => {
  it("leaves an order number beginning with a year alone", () => {
    expect(covered("Pedido 2024-0817 cancelado")).toEqual([]);
  });

  it("still covers a NANP-style number", () => {
    expect(covered("Call 555-0181 today")).toEqual(["555-0181"]);
  });

  it("still covers a Brazilian mobile", () => {
    expect(covered("Ligue 11 98765-4321")).toEqual(["11 98765-4321"]);
  });

  it("leaves a year range alone", () => {
    expect(covered("The 2019-2024 report")).toEqual([]);
  });
});

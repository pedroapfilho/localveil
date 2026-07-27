import { describe, expect, it } from "vitest";

import { LOCALES } from "../locale";

import { en } from "./en";

import { CATALOGUES } from "./index";

const PLACEHOLDER = /\{(?<name>\w+)\}/gv;

const sortedKeys = (catalogue: Readonly<Record<string, string>>) =>
  Object.keys(catalogue).toSorted();

const placeholders = (message: string) =>
  [...message.matchAll(PLACEHOLDER)]
    .map(([, name]) => name)
    .toSorted()
    .join(",");

const catalogueOf = (locale: (typeof LOCALES)[number]): Readonly<Record<string, string>> =>
  CATALOGUES[locale];

describe("catalogues", () => {
  it("ships one catalogue per locale", () => {
    expect(Object.keys(CATALOGUES).toSorted()).toStrictEqual([...LOCALES].toSorted());
  });

  it("keeps pt in step with en, with no missing and no extra keys", () => {
    expect(sortedKeys(catalogueOf("pt"))).toStrictEqual(sortedKeys(en));
  });

  it("keeps es in step with en, with no missing and no extra keys", () => {
    expect(sortedKeys(catalogueOf("es"))).toStrictEqual(sortedKeys(en));
  });

  it("leaves no message empty", () => {
    const empty = LOCALES.flatMap((locale) =>
      Object.entries(catalogueOf(locale))
        .filter(([, message]) => message.trim() === "")
        .map(([key]) => `${locale}.${key}`),
    );

    expect(empty).toStrictEqual([]);
  });

  it("carries the same placeholders in every locale", () => {
    const mismatched = LOCALES.flatMap((locale) => {
      const catalogue = catalogueOf(locale);

      return Object.entries(en)
        .filter(([key, message]) => placeholders(catalogue[key]) !== placeholders(message))
        .map(([key]) => `${locale}.${key}`);
    });

    expect(mismatched).toStrictEqual([]);
  });
});

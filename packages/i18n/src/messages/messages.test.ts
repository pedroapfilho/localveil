import { describe, expect, it } from "vitest";

import { LOCALES } from "../locale";

import { en } from "./en";

import { CATALOGUES } from "./index";

const PLACEHOLDER = /\{(?<name>\w+)\}/gv;

const placeholders = (message: string) =>
  [...message.matchAll(PLACEHOLDER)]
    .map(([placeholder]) => placeholder)
    .toSorted()
    .join(",");

const catalogueOf = (locale: (typeof LOCALES)[number]): Readonly<Record<string, string>> =>
  CATALOGUES[locale];

describe("catalogues", () => {
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
        .filter(([key, message]) => {
          const translated = catalogue[key];

          return translated === undefined || placeholders(translated) !== placeholders(message);
        })
        .map(([key]) => `${locale}.${key}`);
    });

    expect(mismatched).toStrictEqual([]);
  });
});

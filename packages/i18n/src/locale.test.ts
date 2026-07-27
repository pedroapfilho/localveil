import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, isLocale, LOCALES, resolveLocale } from "./locale";

describe("resolveLocale", () => {
  it("matches on the primary subtag so pt-BR is pt", () => {
    expect(resolveLocale(["pt-BR"])).toBe("pt");
  });

  it("ignores the case of the tag", () => {
    expect(resolveLocale(["ES-419"])).toBe("es");
  });

  it("takes the first tag it supports", () => {
    expect(resolveLocale(["de", "fr", "pt-PT", "es"])).toBe("pt");
  });

  it("falls back to the default for an unsupported tag", () => {
    expect(resolveLocale(["de"])).toBe(DEFAULT_LOCALE);
  });

  it("falls back to the default with no preferences at all", () => {
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
  });
});

describe("isLocale", () => {
  it("accepts every shipped locale", () => {
    expect(LOCALES.every((locale) => isLocale(locale))).toBe(true);
  });

  it("rejects a tag with a region", () => {
    expect(isLocale("pt-BR")).toBe(false);
  });
});

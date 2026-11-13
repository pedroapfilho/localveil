const LOCALES = ["en", "pt", "es"] as const;

type Locale = (typeof LOCALES)[number];

const DEFAULT_LOCALE: Locale = "en";

const LOCALE_NAMES = {
  en: "English",
  es: "Español",
  pt: "Português",
} satisfies Record<Locale, string>;

const isLocale = (value: string): value is Locale => LOCALES.some((locale) => locale === value);

const resolveLocale = (preferred: ReadonlyArray<string>): Locale => {
  for (const tag of preferred) {
    const [primary = ""] = tag.toLowerCase().split("-");

    if (isLocale(primary)) {
      return primary;
    }
  }

  return DEFAULT_LOCALE;
};

// Every shipped language tells one from many and nothing finer, so a message has two forms.
const pluralOf = (locale: Locale, count: number) =>
  new Intl.PluralRules(locale).select(count) === "one" ? "one" : "other";

export { DEFAULT_LOCALE, isLocale, LOCALE_NAMES, LOCALES, pluralOf, resolveLocale };

export type { Locale };

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
    const primary = tag.split("-")[0].toLowerCase();

    if (isLocale(primary)) {
      return primary;
    }
  }

  return DEFAULT_LOCALE;
};

export { DEFAULT_LOCALE, isLocale, LOCALE_NAMES, LOCALES, resolveLocale };
export type { Locale };

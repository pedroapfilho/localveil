const LOCALES = ["en", "pt", "es"] as const;

type Locale = (typeof LOCALES)[number];

const DEFAULT_LOCALE: Locale = "en";

// Written in their own language and left untranslated on purpose: a picker has
// to be readable by someone who cannot read the language currently on screen.
const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
};

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

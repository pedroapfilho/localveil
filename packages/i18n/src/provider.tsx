import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { I18nContext } from "./context";
import type { I18nValue } from "./context";
import type { Locale } from "./locale";
import { resolveLocale } from "./locale";
import { readStoredLocale, writeStoredLocale } from "./locale-storage";
import { translator } from "./translate";

type I18nProviderProps = {
  children: ReactNode;
};

const readInitialLocale = (): Locale => {
  const stored = readStoredLocale();

  if (stored !== undefined) {
    return stored;
  }

  return resolveLocale(window.navigator.languages);
};

const I18nProvider = ({ children }: I18nProviderProps) => {
  const [locale, setActiveLocale] = useState<Locale>(readInitialLocale);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale: (next: Locale) => {
        writeStoredLocale(next);
        setActiveLocale(next);
      },
      t: translator(locale),
    }),
    [locale],
  );

  return <I18nContext value={value}>{children}</I18nContext>;
};

export { I18nProvider };

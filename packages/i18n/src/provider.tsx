import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";

import { I18nContext } from "./context";
import type { Locale } from "./locale";
import { isLocale, resolveLocale } from "./locale";
import type { MessageKey } from "./messages/en";
import { CATALOGUES } from "./messages/index";
import type { TranslationValues } from "./translate";
import { translate } from "./translate";

const STORAGE_KEY = "localveil.locale";

type I18nProviderProps = {
  children: ReactNode;
};

// Reading storage and languages off `window` rather than as bare globals keeps
// Node's own experimental `localStorage` and `navigator` out of the way in tests.
const readInitialLocale = (): Locale => {
  const stored = window.localStorage.getItem(STORAGE_KEY);

  if (stored !== null && isLocale(stored)) {
    return stored;
  }

  return resolveLocale(window.navigator.languages);
};

const I18nProvider = ({ children }: I18nProviderProps) => {
  const [locale, setActiveLocale] = useState<Locale>(readInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setActiveLocale(next);
  }, []);

  const value = useMemo(() => {
    const messages = CATALOGUES[locale];

    return {
      locale,
      setLocale,
      t: (key: MessageKey, values?: TranslationValues) => translate(messages, key, values),
    };
  }, [locale, setLocale]);

  return <I18nContext value={value}>{children}</I18nContext>;
};

export { I18nProvider, STORAGE_KEY };
export type { I18nProviderProps };

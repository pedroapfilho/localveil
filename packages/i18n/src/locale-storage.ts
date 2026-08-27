import type { Locale } from "./locale";
import { isLocale } from "./locale";

const STORAGE_KEY = "localveil.locale";

const warnStorageFailed = (action: string, cause: unknown) => {
  // oxlint-disable-next-line eslint/no-console
  console.warn(`Could not ${action} the saved language`, cause);
};

const readStoredLocale = (): Locale | undefined => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (stored !== null && isLocale(stored)) {
      return stored;
    }

    return undefined;
  } catch (error) {
    warnStorageFailed("read", error);

    return undefined;
  }
};

const writeStoredLocale = (locale: Locale) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch (error) {
    warnStorageFailed("update", error);
  }
};

export { readStoredLocale, STORAGE_KEY, writeStoredLocale };

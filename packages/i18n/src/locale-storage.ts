import type { Locale } from "./locale";
import { isLocale } from "./locale";

const STORAGE_KEY = "localveil.locale";

// A language that fails to stick is a preference, not the reader's data, but silence
// would hide a broken key from whoever is debugging it.
const warnStorageFailed = (action: string, error: unknown) => {
  // oxlint-disable-next-line eslint/no-console
  console.warn(`Could not ${action} the saved language`, error);
};

// Merely touching storage throws in Safari private mode, in webviews with
// storage switched off and behind some cookie blockers, so both directions are
// guarded. Reaching through `window` also keeps Node's own experimental
// `localStorage` out of the way in tests.
const readStoredLocale = (): Locale | undefined => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    // An older build or a reader with devtools open can leave anything here.
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

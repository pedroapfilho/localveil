import { createContext } from "react";

import type { Locale } from "./locale";
import type { MessageKey } from "./messages/en";
import type { TranslationValues } from "./translate";

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, values?: TranslationValues) => string;
};

const I18nContext = createContext<I18nValue | undefined>(undefined);

export { I18nContext };
export type { I18nValue };

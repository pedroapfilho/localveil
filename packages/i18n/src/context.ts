import { createContext } from "react";

import type { Locale } from "./locale";
import type { EnglishMessages, MessageKey } from "./messages/en";
import type { PlaceholdersIn, ValuesFor } from "./translate";

type Translate = <Key extends MessageKey>(
  key: Key,
  ...values: [PlaceholdersIn<EnglishMessages[Key]>] extends [never]
    ? []
    : [ValuesFor<EnglishMessages[Key]>]
) => string;

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const I18nContext = createContext<I18nValue | undefined>(undefined);

export { I18nContext };
export type { I18nValue };

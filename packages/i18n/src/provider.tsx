import type { ReactNode } from "react";
import { useMemo } from "react";

import { I18nContext } from "./context";
import { resolveLocale } from "./locale";
import type { MessageKey } from "./messages/en";
import { CATALOGUES } from "./messages/index";
import type { TranslationValues } from "./translate";
import { translate } from "./translate";

type I18nProviderProps = {
  children: ReactNode;
};

const I18nProvider = ({ children }: I18nProviderProps) => {
  const value = useMemo(() => {
    // Reading languages off `window` rather than as a bare global keeps Node's own
    // experimental `navigator` out of the way in tests. The browser is the only
    // source: there is nothing to change the answer once the page is up.
    const locale = resolveLocale(window.navigator.languages);
    const messages = CATALOGUES[locale];

    return {
      locale,
      t: (key: MessageKey, values?: TranslationValues) => translate(messages, key, values),
    };
  }, []);

  return <I18nContext value={value}>{children}</I18nContext>;
};

export { I18nProvider };
export type { I18nProviderProps };

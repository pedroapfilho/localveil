import { use } from "react";

import type { I18nValue } from "./context";
import { I18nContext } from "./context";

const useTranslations = (): I18nValue => {
  const value = use(I18nContext);

  if (value === undefined) {
    throw new Error("useTranslations must be called inside an <I18nProvider>");
  }

  return value;
};

export { useTranslations };

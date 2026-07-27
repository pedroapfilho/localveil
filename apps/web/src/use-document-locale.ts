import { useTranslations } from "@repo/i18n";
import { useEffect } from "react";

const useDocumentLocale = () => {
  const { locale } = useTranslations();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
};

export { useDocumentLocale };

export type { I18nValue } from "./context";
export { DEFAULT_LOCALE, isLocale, LOCALE_NAMES, LOCALES, resolveLocale } from "./locale";
export type { Locale } from "./locale";
// The catalogues as values, not only as types. A caller outside React, such as the
// terminal app, still has to turn a stage key into a sentence, and copying the lines
// into a second file is how two of them drift apart.
export { CATALOGUES } from "./messages/index";
export type { MessageKey, Messages } from "./messages/en";
export { I18nProvider } from "./provider";
export { translate } from "./translate";
export type { TranslationValues } from "./translate";
export { useTranslations } from "./use-translations";

import type { Locale } from "./locale";
import type { EnglishMessages, MessageKey } from "./messages/en";
import { CATALOGUES } from "./messages/index";

type TranslationValues = Record<string, number | string>;

type PlaceholdersIn<Message extends string> =
  Message extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceholdersIn<Rest> : never;

type ValuesFor<Message extends string> = [PlaceholdersIn<Message>] extends [never]
  ? Record<string, never>
  : Record<PlaceholdersIn<Message>, number | string>;

const PLACEHOLDER = /\{(?<name>\w+)\}/gv;

const translate = (
  messages: Readonly<Record<string, string>>,
  key: string,
  values: TranslationValues = {},
) => {
  const message = Object.hasOwn(messages, key) ? messages[key] : undefined;

  if (message === undefined) {
    throw new Error(`No translation for "${key}"`);
  }

  return message.replaceAll(PLACEHOLDER, (_placeholder, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Translation "${key}" needs a value for "${name}"`);
    }

    return String(values[name]);
  });
};

// A key whose message has placeholders cannot be called without their values.
type Translate = <Key extends MessageKey>(
  key: Key,
  ...values: [PlaceholdersIn<EnglishMessages[Key]>] extends [never]
    ? []
    : [ValuesFor<EnglishMessages[Key]>]
) => string;

const translator = (locale: Locale): Translate => {
  const messages = CATALOGUES[locale];

  return (key: MessageKey, values?: TranslationValues) => translate(messages, key, values);
};

export { translate, translator };

export type { Translate };

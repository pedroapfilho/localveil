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
  if (!Object.hasOwn(messages, key)) {
    throw new Error(`No translation for "${key}"`);
  }

  return messages[key].replaceAll(PLACEHOLDER, (_placeholder, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Translation "${key}" needs a value for "${name}"`);
    }

    return String(values[name]);
  });
};

export { translate };
export type { PlaceholdersIn, TranslationValues, ValuesFor };

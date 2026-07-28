import { CATALOGUES, translate } from "@repo/i18n";

// English only: the terminal reads no locale preference.
const CATALOGUE = CATALOGUES.en;

// `translate` throws on a key it does not know, and losing a finished run to an
// unrecognised warning would be a poor trade.
const describeKey = (key: string): string =>
  Object.hasOwn(CATALOGUE, key) ? translate(CATALOGUE, key) : key;

export { describeKey };

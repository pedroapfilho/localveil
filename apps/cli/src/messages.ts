import { CATALOGUES, translate } from "@repo/i18n";

// English only. The terminal has no locale picker and reads no preference, so the
// catalogue is named outright rather than resolved.
const CATALOGUE = CATALOGUES.en;

// Stages and warnings reach the CLI as bare strings from the redactor, so a key the
// catalogue has never heard of has to read as itself. `translate` throws on a miss,
// and losing a finished run to an unrecognised warning would be a poor trade.
const describeKey = (key: string): string =>
  Object.hasOwn(CATALOGUE, key) ? translate(CATALOGUE, key) : key;

export { describeKey };

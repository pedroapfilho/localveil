import { CATALOGUES, translate } from "@repo/i18n";

const CATALOGUE = CATALOGUES.en;

const describeKey = (key: string): string =>
  Object.hasOwn(CATALOGUE, key) ? translate(CATALOGUE, key) : key;

export { describeKey };

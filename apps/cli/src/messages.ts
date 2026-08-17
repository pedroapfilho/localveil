import type { MessageKey } from "@repo/i18n";
import { CATALOGUES, translate } from "@repo/i18n";

const CATALOGUE = CATALOGUES.en;

const describeKey = (key: MessageKey): string => translate(CATALOGUE, key);

export { describeKey };

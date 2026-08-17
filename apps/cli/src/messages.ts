import type { MessageKey } from "@repo/i18n";
import { CATALOGUES, translate } from "@repo/i18n";

const CATALOGUE = CATALOGUES.en;

// The keys are a union, so a stage or warning the catalogue has no line for is a type error
// rather than the raw key being printed at the user.
const describeKey = (key: MessageKey): string => translate(CATALOGUE, key);

export { describeKey };

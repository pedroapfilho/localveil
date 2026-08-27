import type { Locale } from "../locale";

import { en } from "./en";
import type { Messages } from "./en";
import { es } from "./es";
import { pt } from "./pt";

const CATALOGUES = { en, es, pt } satisfies Record<Locale, Messages>;

export { CATALOGUES };

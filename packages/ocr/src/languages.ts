type OcrLanguage = "en" | "es" | "pt";

type DetectedLanguage = { confidence: number; language: OcrLanguage };

const TRAINEDDATA = {
  en: "eng",
  es: "spa",
  pt: "por",
} satisfies Record<OcrLanguage, string>;

const STOPWORDS = {
  en: new Set([
    "and",
    "are",
    "at",
    "be",
    "but",
    "for",
    "from",
    "have",
    "in",
    "is",
    "it",
    "not",
    "of",
    "on",
    "that",
    "the",
    "they",
    "this",
    "to",
    "was",
    "with",
  ]),
  es: new Set([
    "del",
    "el",
    "ella",
    "ese",
    "esta",
    "este",
    "esto",
    "fecha",
    "firma",
    "fue",
    "hasta",
    "hay",
    "la",
    "las",
    "los",
    "muy",
    "nombre",
    "pero",
    "sus",
    "tambien",
    "una",
    "validez",
    "ya",
  ]),
  pt: new Set([
    "ao",
    "aos",
    "assinatura",
    "ate",
    "da",
    "das",
    "dos",
    "ela",
    "ele",
    "em",
    "emissao",
    "entao",
    "filiacao",
    "foi",
    "habilitacao",
    "isso",
    "ja",
    "muito",
    "nao",
    "nascimento",
    "nome",
    "numa",
    "pela",
    "pelo",
    "sao",
    "seu",
    "sua",
    "tambem",
    "uma",
    "validade",
    "voce",
  ]),
};

const LANGUAGES: ReadonlyArray<OcrLanguage> = ["en", "es", "pt"];

const MIN_HITS = 5;

const WORD = /[\p{Letter}']+/gv;
const COMBINING_MARK = /\p{Mark}/gv;

const normalise = (text: string) =>
  text.normalize("NFD").replaceAll(COMBINING_MARK, "").toLowerCase();

const tally = (tokens: Array<string>) => {
  const scores = new Map<OcrLanguage, number>(LANGUAGES.map((language) => [language, 0]));

  for (const token of tokens) {
    for (const language of LANGUAGES) {
      if (STOPWORDS[language].has(token)) {
        scores.set(language, (scores.get(language) ?? 0) + 1);
      }
    }
  }

  return scores;
};

const detectLanguage = (text: string, fallback: OcrLanguage = "en"): DetectedLanguage => {
  const tokens = normalise(text).match(WORD) ?? [];
  const scores = tally([...tokens]);
  const ranked = [...scores.entries()].toSorted(([, left], [, right]) => right - left);
  const [top, second] = ranked;
  const hits = [...scores.values()].reduce((sum, score) => sum + score, 0);

  if (top === undefined || top[1] === 0) {
    return { confidence: 0, language: fallback };
  }

  const share = top[1] / hits;
  const volume = Math.min(1, hits / MIN_HITS);
  const decisive = second === undefined || top[1] > second[1];

  return decisive
    ? { confidence: share * volume, language: top[0] }
    : { confidence: 0, language: fallback };
};

const traineddataFor = (language: OcrLanguage) => TRAINEDDATA[language];

export { detectLanguage, LANGUAGES, traineddataFor };
export type { DetectedLanguage, OcrLanguage };

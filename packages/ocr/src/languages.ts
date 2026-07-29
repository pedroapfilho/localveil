type OcrLanguage = "en" | "es" | "pt";

type DetectedLanguage = { confidence: number; language: OcrLanguage };

// Tesseract names languages by ISO 639-2, the app by ISO 639-1.
const TRAINEDDATA: Record<OcrLanguage, string> = {
  en: "eng",
  es: "spa",
  pt: "por",
};

// Words that appear in one of the three lists only: function words, plus the field
// labels identity documents print, because an ID card carries almost no prose to
// vote with. Written without accents, since the first OCR pass runs in English and
// drops most of them.
const STOPWORDS: Record<OcrLanguage, ReadonlySet<string>> = {
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

// Below this many stopword matches, the winner's share is not evidence of anything.
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

// "tambem" sits in both Iberian lists on purpose: it is common enough to be worth
// counting and it never points at English, so it lifts both equally and decides
// nothing on its own.
const detectLanguage = (text: string, fallback: OcrLanguage = "en"): DetectedLanguage => {
  const tokens = normalise(text).match(WORD) ?? [];
  const scores = tally([...tokens]);
  const ranked = [...scores.entries()].toSorted(([, left], [, right]) => right - left);
  const [top, second] = ranked;
  const hits = [...scores.values()].reduce((sum, score) => sum + score, 0);

  if (top === undefined || top[1] === 0) {
    return { confidence: 0, language: fallback };
  }

  // One lucky hit would otherwise score a perfect share.
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

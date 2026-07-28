type OcrLanguage = "en" | "es" | "pt";

type DetectedLanguage = { confidence: number; language: OcrLanguage };

// Tesseract names languages by ISO 639-2, the app by ISO 639-1.
const TRAINEDDATA: Record<OcrLanguage, string> = {
  en: "eng",
  es: "spa",
  pt: "por",
};

// Function words only, and only ones that do not appear in the other two lists: the
// point is to tell these three apart, not to describe them. Written without accents
// because the first OCR pass runs in English and drops most of them, which is
// exactly the text this has to work on.
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
    "fue",
    "hasta",
    "hay",
    "la",
    "las",
    "los",
    "muy",
    "pero",
    "sus",
    "tambien",
    "una",
    "ya",
  ]),
  pt: new Set([
    "ate",
    "das",
    "dos",
    "ela",
    "ele",
    "entao",
    "foi",
    "isso",
    "ja",
    "muito",
    "nao",
    "pela",
    "pelo",
    "sao",
    "seu",
    "sua",
    "tambem",
    "uma",
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

  // Two things have to hold before a guess is worth acting on: the winner took most
  // of the matches, and there were enough matches for that share to mean anything.
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

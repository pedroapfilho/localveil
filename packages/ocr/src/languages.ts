import type { DocumentLanguage } from "@repo/redact-core";
import { DOCUMENT_LANGUAGES } from "@repo/redact-core";

const TRAINEDDATA = {
  en: "eng",
  es: "spa",
  pt: "por",
} satisfies Record<DocumentLanguage, string>;

const WORD = /[\p{Letter}']+/gv;
const COMBINING_MARK = /\p{Mark}/gv;

const normalise = (text: string) =>
  text.normalize("NFD").replaceAll(COMBINING_MARK, "").toLowerCase();

// Tokens are folded before they are counted, so the stopwords are folded the same way.
const stopwords = (words: ReadonlyArray<string>) => new Set(words.map(normalise));

const STOPWORDS = {
  en: stopwords([
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
  es: stopwords([
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
  pt: stopwords([
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
} satisfies Record<DocumentLanguage, ReadonlySet<string>>;

const MIN_HITS = 5;

const MIN_CONFIDENCE = 0.5;

const tally = (tokens: Array<string>) => {
  const scores = new Map<DocumentLanguage, number>(
    DOCUMENT_LANGUAGES.map((language) => [language, 0]),
  );

  for (const token of tokens) {
    for (const language of DOCUMENT_LANGUAGES) {
      if (STOPWORDS[language].has(token)) {
        scores.set(language, (scores.get(language) ?? 0) + 1);
      }
    }
  }

  return scores;
};

/* A language is named only when its stopwords outvote every other's and there are enough of them
   to trust: a few stray hits name nothing, and the caller reads in its default instead. */
const languageOf = (text: string): DocumentLanguage | undefined => {
  const tokens = normalise(text).match(WORD) ?? [];
  const scores = tally([...tokens]);
  const [top, second] = [...scores.entries()].toSorted(([, left], [, right]) => right - left);
  const hits = [...scores.values()].reduce((sum, score) => sum + score, 0);

  if (top === undefined || top[1] === 0 || (second !== undefined && top[1] <= second[1])) {
    return undefined;
  }

  const confidence = (top[1] / hits) * Math.min(1, hits / MIN_HITS);

  return confidence >= MIN_CONFIDENCE ? top[0] : undefined;
};

const traineddataFor = (language: DocumentLanguage) => TRAINEDDATA[language];

export { languageOf, traineddataFor };

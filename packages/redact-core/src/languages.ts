const DOCUMENT_LANGUAGES = ["en", "es", "pt"] as const;

type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

const isDocumentLanguage = (value: unknown): value is DocumentLanguage =>
  DOCUMENT_LANGUAGES.some((language) => language === value);

export { DOCUMENT_LANGUAGES, isDocumentLanguage };

export type { DocumentLanguage };

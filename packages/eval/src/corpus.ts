import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { DocumentLanguage, PiiLabel } from "@repo/redact-core";

const LABELS = new Set<string>([
  "account_number",
  "private_address",
  "private_date",
  "private_email",
  "private_person",
  "private_phone",
  "private_url",
  "secret",
]);

const LANGUAGES = new Set<string>(["en", "es", "pt"]);

const MARK = /\[\[(?<label>[a-z_]+)\|(?<value>[^\]]*)\]\]/gv;

type LabelledSpan = { end: number; label: PiiLabel; start: number };

type EvalDocument = {
  id: string;
  language: DocumentLanguage;
  source: "handwritten" | "synthetic";
  spans: Array<LabelledSpan>;
  text: string;
};

type MarkedDocument = {
  id: string;
  language: DocumentLanguage;
  marked: string;
  source: "handwritten" | "synthetic";
};

const CORPUS_DIR = path.join(import.meta.dirname, "..", "corpus");

const isLabel = (value: string): value is PiiLabel => LABELS.has(value);

const isLanguage = (value: unknown): value is DocumentLanguage =>
  typeof value === "string" && LANGUAGES.has(value);

const parseMarked = (marked: string, id: string) => {
  const spans: Array<LabelledSpan> = [];
  let text = "";
  let read = 0;

  for (const match of marked.matchAll(MARK)) {
    const label = match.groups?.label ?? "";
    const value = match.groups?.value ?? "";

    if (!isLabel(label)) {
      throw new TypeError(`${id} marks a span as "${label}", which is not a PII label`);
    }

    if (value.length === 0) {
      throw new TypeError(`${id} marks an empty span as "${label}"`);
    }

    text += marked.slice(read, match.index);
    spans.push({ end: text.length + value.length, label, start: text.length });
    text += value;
    read = match.index + match[0].length;
  }

  return { spans, text: text + marked.slice(read) };
};

const toDocument = (raw: unknown, file: string): EvalDocument => {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError(`${file} does not hold an object`);
  }

  const id: unknown = Reflect.get(raw, "id");
  const language: unknown = Reflect.get(raw, "language");
  const marked: unknown = Reflect.get(raw, "marked");
  const source: unknown = Reflect.get(raw, "source");

  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError(`${file} has no id`);
  }

  if (!isLanguage(language)) {
    throw new TypeError(`${id} declares no supported language`);
  }

  if (typeof marked !== "string" || marked.length === 0) {
    throw new TypeError(`${id} has no marked text`);
  }

  if (source !== "handwritten" && source !== "synthetic") {
    throw new TypeError(`${id} declares no source`);
  }

  const { spans, text } = parseMarked(marked, id);

  for (const span of spans) {
    if (span.start < 0 || span.end > text.length || span.start >= span.end) {
      throw new RangeError(`${id} places a span at ${span.start}-${span.end}, outside its text`);
    }
  }

  return { id, language, source, spans, text };
};

const loadCorpus = async (directory = CORPUS_DIR): Promise<Array<EvalDocument>> => {
  const entries = await readdir(directory);
  const files = entries.filter((name) => name.endsWith(".json")).toSorted();

  const documents = await Promise.all(
    files.map(async (name) => {
      const raw: unknown = JSON.parse(await readFile(path.join(directory, name), "utf8"));

      return toDocument(raw, name);
    }),
  );

  const seen = new Set<string>();

  for (const document of documents) {
    if (seen.has(document.id)) {
      throw new TypeError(`Two corpus documents both call themselves ${document.id}`);
    }

    seen.add(document.id);
  }

  return documents;
};

export { CORPUS_DIR, loadCorpus, parseMarked };
export type { EvalDocument, LabelledSpan, MarkedDocument };

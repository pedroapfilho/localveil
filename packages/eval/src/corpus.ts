import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { DocumentLanguage, PiiLabel } from "@repo/redact-core";
import { isDocumentLanguage, isPiiLabel } from "@repo/redact-core";
import type { TextFormat } from "@repo/redact-text";
import { isTextFormat } from "@repo/redact-text";

const MARK = /\[\[(?<label>[a-z_]+)\|(?<value>[^\]]*)\]\]/gv;

type LabelledSpan = { end: number; label: PiiLabel; start: number };

type EvalDocument = {
  format: TextFormat;
  id: string;
  language: DocumentLanguage;
  source: "handwritten" | "synthetic";
  spans: Array<LabelledSpan>;
  text: string;
};

type CorpusFields = {
  format?: unknown;
  id?: unknown;
  language?: unknown;
  marked?: unknown;
  source?: unknown;
};

const CORPUS_DIR = path.join(import.meta.dirname, "..", "corpus");

const parseMarked = (marked: string, id: string) => {
  const spans: Array<LabelledSpan> = [];
  let text = "";
  let read = 0;

  for (const match of marked.matchAll(MARK)) {
    const label = match.groups?.label ?? "";
    const value = match.groups?.value ?? "";

    if (!isPiiLabel(label)) {
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

const readFields = (json: string, file: string): CorpusFields => {
  const raw: unknown = JSON.parse(json);

  if (typeof raw !== "object" || raw === null) {
    throw new TypeError(`${file} does not hold an object`);
  }

  return { format: "text", ...raw };
};

const toDocument = (json: string, file: string): EvalDocument => {
  const { format, id, language, marked, source } = readFields(json, file);

  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError(`${file} has no id`);
  }

  if (!isDocumentLanguage(language)) {
    throw new TypeError(`${id} declares no supported language`);
  }

  if (typeof marked !== "string" || marked.length === 0) {
    throw new TypeError(`${id} has no marked text`);
  }

  if (source !== "handwritten" && source !== "synthetic") {
    throw new TypeError(`${id} declares no source`);
  }

  if (!isTextFormat(format)) {
    throw new TypeError(`${id} declares a format no text redactor reads`);
  }

  return { format, id, language, source, ...parseMarked(marked, id) };
};

const loadCorpus = async (): Promise<Array<EvalDocument>> => {
  const entries = await readdir(CORPUS_DIR);
  const files = entries.filter((name) => name.endsWith(".json")).toSorted();

  const documents = await Promise.all(
    files.map(async (name) => {
      return toDocument(await readFile(path.join(CORPUS_DIR, name), "utf8"), name);
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

export { loadCorpus, parseMarked };

export type { EvalDocument, LabelledSpan };

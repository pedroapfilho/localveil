import { readdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import type { DocumentLanguage } from "@repo/redact-node";
import { SUPPORTED_EXTENSIONS } from "@repo/redact-node";

const PARENT_NAME = "..";

type DirectoryEntry = {
  isDirectory: boolean;
  name: string;
  path: string;
  supported: boolean;
};

type StartingPoint = {
  directory: string;
  language?: DocumentLanguage;
  selection: Array<string>;
};

const DOCUMENT_LANGUAGES: ReadonlyArray<DocumentLanguage> = ["en", "es", "pt"];

const isDocumentLanguage = (value: string): value is DocumentLanguage =>
  DOCUMENT_LANGUAGES.some((language) => language === value);

type ParsedFlags = { language?: DocumentLanguage; paths: Array<string> };

// `--lang pt` skips the language guessing, which is the weakest stage on documents
// that carry almost no prose, identity cards above all.
const parseFlags = (args: ReadonlyArray<string>): ParsedFlags => {
  const paths: Array<string> = [];
  let language: DocumentLanguage | undefined;

  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    const value = arg === "--lang" ? args[at + 1] : /^--lang=(?<lang>.+)$/v.exec(arg)?.groups?.lang;

    if (arg === "--lang") {
      at += 1;
    } else if (!arg.startsWith("--lang=")) {
      paths.push(arg);
      continue;
    }

    if (value === undefined || !isDocumentLanguage(value)) {
      throw new RangeError(
        `--lang takes one of ${DOCUMENT_LANGUAGES.join(", ")}, not ${value ?? "nothing"}`,
      );
    }

    language = value;
  }

  return { language, paths };
};

const isSupported = (name: string): boolean =>
  SUPPORTED_EXTENSIONS.includes(extname(name).toLowerCase());

const byKind = (left: DirectoryEntry, right: DirectoryEntry): number => {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
};

const readDirectory = async (directory: string): Promise<Array<DirectoryEntry>> => {
  const found = await readdir(directory, { withFileTypes: true });

  const entries = found.map((entry) => {
    const isDirectory = entry.isDirectory();

    return {
      isDirectory,
      name: entry.name,
      path: resolve(directory, entry.name),
      supported: !isDirectory && isSupported(entry.name),
    };
  });

  return entries.toSorted(byKind);
};

const parentEntry = (directory: string): DirectoryEntry | null => {
  const parent = dirname(directory);

  if (parent === directory) {
    return null;
  }

  return { isDirectory: true, name: PARENT_NAME, path: parent, supported: false };
};

// A path that cannot be reached is dropped rather than thrown: one bad argument
// should not stop somebody browsing for the files that are fine.
const describePath = async (path: string) => {
  const info = await stat(path);

  return { isDirectory: info.isDirectory(), path };
};

const resolveArguments = async (
  args: ReadonlyArray<string>,
  workingDirectory: string,
): Promise<StartingPoint> => {
  const { language, paths } = parseFlags(args);

  if (paths.length === 0) {
    return { directory: workingDirectory, ...(language && { language }), selection: [] };
  }

  const settled = await Promise.allSettled(
    paths.map((arg) => describePath(resolve(workingDirectory, arg))),
  );

  const selection: Array<string> = [];
  const directories: Array<string> = [];

  for (const outcome of settled) {
    if (outcome.status !== "fulfilled") {
      continue;
    }

    const { isDirectory, path } = outcome.value;

    if (isDirectory) {
      directories.push(path);
      continue;
    }

    if (isSupported(path)) {
      selection.push(path);
    }
  }

  const first = selection[0];
  const directory = first === undefined ? (directories[0] ?? workingDirectory) : dirname(first);

  return { directory, ...(language && { language }), selection };
};

export { isSupported, parentEntry, readDirectory, resolveArguments };
export type { DirectoryEntry };

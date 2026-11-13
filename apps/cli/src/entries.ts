import { readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { isModelId, MODELS } from "@repo/pii-detect/models";
import { nodeTypeOf } from "@repo/redact";

import type { RunSettings } from "./run-redaction";
import { OPTIONS } from "./usage";

const PARENT_NAME = "..";

type DirectoryEntry = {
  isDirectory: boolean;
  name: string;
  path: string;
  supported: boolean;
};

type StartingPoint = {
  directory: string;
  help: boolean;
  selection: Array<string>;
  settings: RunSettings;
};

type ParsedFlags = { help: boolean; paths: Array<string>; settings: RunSettings };

const parseFlags = (args: ReadonlyArray<string>): ParsedFlags => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: [...args],
    options: OPTIONS,
  });

  const settings: RunSettings = {};

  if (values.jobs !== undefined) {
    const count = Number(values.jobs);

    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError(`--jobs takes a whole number of 1 or more, not ${values.jobs}`);
    }

    settings.jobs = count;
  }

  if (values.model !== undefined) {
    if (!isModelId(values.model)) {
      throw new RangeError(
        `--model takes one of ${MODELS.map((entry) => entry.id).join(", ")}, not ${values.model}`,
      );
    }

    settings.model = values.model;
  }

  return { help: values.help === true, paths: positionals, settings };
};

const isSupported = (name: string): boolean => nodeTypeOf(name) !== undefined;

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

const describePath = async (path: string) => {
  const info = await stat(path);

  return { isDirectory: info.isDirectory(), path };
};

const resolveArguments = async (
  args: ReadonlyArray<string>,
  workingDirectory: string,
): Promise<StartingPoint> => {
  const { help, paths, settings } = parseFlags(args);

  if (help || paths.length === 0) {
    return { directory: workingDirectory, help, selection: [], settings };
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

  const first = selection.at(0);
  const directory = first === undefined ? (directories[0] ?? workingDirectory) : dirname(first);

  return { directory, help, selection, settings };
};

export { isSupported, parentEntry, readDirectory, resolveArguments };

export type { DirectoryEntry };

import { readdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

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
  selection: Array<string>;
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
  if (args.length === 0) {
    return { directory: workingDirectory, selection: [] };
  }

  const settled = await Promise.allSettled(
    args.map((arg) => describePath(resolve(workingDirectory, arg))),
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

  // Start beside the first named file so its tick is on screen, and only fall back
  // to a named directory when no file was given.
  const first = selection[0];
  const directory = first === undefined ? (directories[0] ?? workingDirectory) : dirname(first);

  return { directory, selection };
};

export { isSupported, parentEntry, readDirectory, resolveArguments };
export type { DirectoryEntry };

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
  jobs?: number;
  selection: Array<string>;
};

type ParsedFlags = { jobs?: number; paths: Array<string> };

const valueOf = (args: ReadonlyArray<string>, at: number, name: string) => {
  const arg = args[at];

  if (arg === `--${name}`) {
    return { extra: 1, value: args[at + 1] };
  }

  const prefix = `--${name}=`;

  return arg.startsWith(prefix) ? { extra: 0, value: arg.slice(prefix.length) } : undefined;
};

const parseFlags = (args: ReadonlyArray<string>): ParsedFlags => {
  const paths: Array<string> = [];
  let jobs: number | undefined;

  for (let at = 0; at < args.length; at += 1) {
    const parallel = valueOf(args, at, "jobs");

    if (parallel !== undefined) {
      const count = Number(parallel.value);

      if (!Number.isInteger(count) || count < 1) {
        throw new RangeError(
          `--jobs takes a whole number of 1 or more, not ${parallel.value ?? "nothing"}`,
        );
      }

      jobs = count;
      at += parallel.extra;
      continue;
    }

    paths.push(args[at]);
  }

  return { jobs, paths };
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

const describePath = async (path: string) => {
  const info = await stat(path);

  return { isDirectory: info.isDirectory(), path };
};

const resolveArguments = async (
  args: ReadonlyArray<string>,
  workingDirectory: string,
): Promise<StartingPoint> => {
  const { jobs, paths } = parseFlags(args);

  if (paths.length === 0) {
    return {
      directory: workingDirectory,
      ...(jobs !== undefined && { jobs }),
      selection: [],
    };
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

  return {
    directory,
    ...(jobs !== undefined && { jobs }),
    selection,
  };
};

export { isSupported, parentEntry, readDirectory, resolveArguments };
export type { DirectoryEntry };

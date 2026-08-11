type SelectedFile = { file: File; path: string };

type Selection = {
  files: Array<SelectedFile>;
  limited: boolean;
};

declare global {
  // Window declarations require an interface so this experimental API can merge with lib.dom.
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

// A folder of scans is easy to choose and expensive to redact, and every file becomes a job the
// pool holds until it is downloaded. Past this many the browser is likelier to run out of memory
// than the user is to have meant it.
const MOST_FILES = 200;

const cleanPath = (parts: Array<string>) => {
  const clean: Array<string> = [];

  for (const part of parts) {
    for (const segment of part.split("/")) {
      if (segment !== "" && segment !== "." && segment !== "..") {
        clean.push(segment);
      }
    }
  }

  return clean.join("/");
};

const selected = (file: File, path = file.webkitRelativePath || file.name): SelectedFile => ({
  file,
  path: cleanPath([path]) || file.name,
});

const selectedFiles = (files: Iterable<File>): Selection => {
  const found: Array<SelectedFile> = [];

  for (const file of files) {
    if (found.length === MOST_FILES) {
      return { files: found, limited: true };
    }

    found.push(selected(file));
  }

  return { files: found, limited: false };
};

const isDirectory = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry =>
  entry.isDirectory && "createReader" in entry && typeof entry.createReader === "function";

const isFile = (entry: FileSystemEntry): entry is FileSystemFileEntry =>
  entry.isFile && "file" in entry && typeof entry.file === "function";

const fileOf = (entry: FileSystemFileEntry) =>
  new Promise<File | undefined>((resolve) => {
    entry.file(resolve, () => {
      resolve(undefined);
    });
  });

// readEntries hands back a page at a time and signals the end with an empty page. Yielding those
// pages instead of collecting them all lets the walk stop at its file cap even for a huge folder.
const childrenOf = async function* (entry: FileSystemDirectoryEntry) {
  const reader = entry.createReader();

  const readPage = () =>
    new Promise<Array<FileSystemEntry>>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });

  /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop */
  for (let page = await readPage(); page.length > 0; page = await readPage()) {
    yield* page;
  }
  /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop */
};

const walkEntry = async (
  entry: FileSystemEntry,
  parent: Array<string>,
  into: Array<SelectedFile>,
): Promise<void> => {
  if (into.length > MOST_FILES) {
    return;
  }

  if (isDirectory(entry)) {
    const here = [...parent, entry.name];

    /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */
    for await (const child of childrenOf(entry)) {
      await walkEntry(child, here, into);

      if (into.length > MOST_FILES) {
        return;
      }
    }
    /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */

    return;
  }

  if (!isFile(entry)) {
    return;
  }

  const file = await fileOf(entry);

  if (file !== undefined) {
    const path = entry.fullPath || cleanPath([...parent, entry.name]);

    into.push(selected(file, path));
  }
};

const asEntry = (item: DataTransferItem): FileSystemEntry | undefined => {
  const get = item.webkitGetAsEntry;

  return typeof get === "function" ? (get.call(item) ?? undefined) : undefined;
};

/** Reads what was dropped, walking into folders where the browser exposes directory entries. */
const droppedFiles = async (transfer: DataTransfer): Promise<Selection> => {
  // These entries have to be captured synchronously, before the drop event is recycled. The walk
  // can then continue asynchronously. Browsers without the entry API keep the flat file behavior.
  const entries = [...transfer.items].flatMap((item) => {
    const entry = item.kind === "file" ? asEntry(item) : undefined;

    return entry === undefined ? [] : [entry];
  });

  if (entries.length === 0) {
    return selectedFiles(transfer.files);
  }

  const found: Array<SelectedFile> = [];

  /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */
  for (const entry of entries) {
    await walkEntry(entry, [], found);

    if (found.length > MOST_FILES) {
      break;
    }
  }
  /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */

  return { files: found.slice(0, MOST_FILES), limited: found.length > MOST_FILES };
};

const walkHandle = async (
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
  parent: Array<string>,
  into: Array<SelectedFile>,
): Promise<void> => {
  if (into.length > MOST_FILES) {
    return;
  }

  if (handle.kind === "file") {
    const file = await handle.getFile();

    into.push(selected(file, cleanPath([...parent, handle.name])));
    return;
  }

  const here = [...parent, handle.name];

  /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */
  for await (const child of handle.values()) {
    await walkHandle(child, here, into);

    if (into.length > MOST_FILES) {
      return;
    }
  }
  /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */
};

/** Opens the modern directory picker, or returns undefined so the caller can use an input. */
const pickedDirectoryFiles = async (): Promise<Selection | undefined> => {
  const picker = window.showDirectoryPicker;

  if (typeof picker !== "function") {
    return undefined;
  }

  const directory = await picker.call(window);
  const found: Array<SelectedFile> = [];

  await walkHandle(directory, [], found);

  return { files: found.slice(0, MOST_FILES), limited: found.length > MOST_FILES };
};

export { droppedFiles, MOST_FILES, pickedDirectoryFiles, selectedFiles };
export type { SelectedFile, Selection };

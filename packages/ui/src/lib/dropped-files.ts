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

/**
 * Walks one tree of files, whichever API exposes it, and stops as soon as the cap is passed. The
 * two directory APIs differ only in how children are listed and how a file is opened, so that is
 * all each one supplies.
 */
type Tree<Node> = {
  childrenOf: (node: Node) => AsyncIterable<Node> | Iterable<Node>;
  fileOf: (node: Node) => Promise<File | undefined>;
  isDirectory: (node: Node) => boolean;
  nameOf: (node: Node) => string;
  pathOf?: (node: Node) => string | undefined;
};

const collect = async <Node>(
  roots: Iterable<Node>,
  tree: Tree<Node>,
  into: Array<SelectedFile>,
): Promise<void> => {
  const walk = async (node: Node, parent: Array<string>): Promise<void> => {
    if (into.length > MOST_FILES) {
      return;
    }

    if (tree.isDirectory(node)) {
      const here = [...parent, tree.nameOf(node)];

      /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */
      for await (const child of tree.childrenOf(node)) {
        await walk(child, here);

        if (into.length > MOST_FILES) {
          return;
        }
      }
      /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */

      return;
    }

    const file = await tree.fileOf(node);

    if (file !== undefined) {
      const own = tree.pathOf?.(node);
      const here = [...parent, tree.nameOf(node)];

      into.push(selected(file, own === undefined || own === "" ? cleanPath(here) : own));
    }
  };

  /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */
  for (const root of roots) {
    await walk(root, []);

    if (into.length > MOST_FILES) {
      return;
    }
  }
  /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/async-defer-await */
};

const capped = (found: Array<SelectedFile>): Selection => ({
  files: found.slice(0, MOST_FILES),
  limited: found.length > MOST_FILES,
});

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

  await collect(
    entries,
    {
      childrenOf: (entry) => (isDirectory(entry) ? childrenOf(entry) : []),
      fileOf: (entry) => (isFile(entry) ? fileOf(entry) : Promise.resolve(undefined)),
      isDirectory,
      nameOf: (entry) => entry.name,
      pathOf: (entry) => entry.fullPath,
    },
    found,
  );

  return capped(found);
};

/** Opens the modern directory picker, or returns undefined so the caller can use an input. */
const pickedDirectoryFiles = async (): Promise<Selection | undefined> => {
  const picker = window.showDirectoryPicker;

  if (typeof picker !== "function") {
    return undefined;
  }

  const directory = await picker.call(window);
  const found: Array<SelectedFile> = [];

  type Handle = FileSystemDirectoryHandle | FileSystemFileHandle;

  await collect<Handle>(
    [directory],
    {
      childrenOf: (handle) => (handle.kind === "directory" ? handle.values() : []),
      fileOf: (handle) => (handle.kind === "file" ? handle.getFile() : Promise.resolve(undefined)),
      isDirectory: (handle) => handle.kind === "directory",
      nameOf: (handle) => handle.name,
    },
    found,
  );

  return capped(found);
};

export { droppedFiles, MOST_FILES, pickedDirectoryFiles, selectedFiles };
export type { SelectedFile, Selection };

import { dirname } from "node:path";

import { Box, Text, useInput, useWindowSize } from "ink";
import { useEffect, useMemo, useState } from "react";

import type { DirectoryEntry } from "./entries";
import { parentEntry, readDirectory } from "./entries";
import { reasonFrom } from "./errors";
import { truncateEnd, truncateStart } from "./text";

const VISIBLE_ROWS = 10;

const LEGEND = "[x] picked  [ ] pick with space  [-] unsupported  [>] folder";

const HELP = "up/down move  space pick  enter open folder or confirm  esc quit";

// Hoisted so the default does not hand the component a brand new array on every
// render, which would restart the picked set each time.
const NO_SELECTION: ReadonlyArray<string> = [];

type Listing = {
  directory: string;
  entries: Array<DirectoryEntry> | null;
  failure: string | null;
};

type Props = {
  initialDirectory: string;
  initialSelection?: ReadonlyArray<string>;
  onCancel: () => void;
  onConfirm: (files: Array<string>) => void;
};

const markerFor = (entry: DirectoryEntry, picked: boolean): string => {
  if (entry.isDirectory) {
    return "[>]";
  }

  if (!entry.supported) {
    return "[-]";
  }

  return picked ? "[x]" : "[ ]";
};

// A window rather than the whole listing, kept around the cursor, so a directory
// with a thousand entries does not redraw a thousand lines on every keystroke.
const windowStart = (cursor: number, length: number): number => {
  const half = Math.floor(VISIBLE_ROWS / 2);
  const last = Math.max(0, length - VISIBLE_ROWS);

  return Math.min(Math.max(0, cursor - half), last);
};

const FileBrowser = ({
  initialDirectory,
  initialSelection = NO_SELECTION,
  onCancel,
  onConfirm,
}: Props) => {
  const { columns } = useWindowSize();
  const [directory, setDirectory] = useState(initialDirectory);
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(initialSelection));

  // The listing carries the directory it belongs to, so "still loading" is read off
  // the two rather than kept in a third piece of state that has to be reset in step.
  const [listing, setListing] = useState<Listing>(() => ({
    directory: initialDirectory,
    entries: null,
    failure: null,
  }));

  useEffect(() => {
    const pending = new AbortController();

    const load = async () => {
      try {
        const found = await readDirectory(directory);

        if (!pending.signal.aborted) {
          setListing({ directory, entries: found, failure: null });
        }
      } catch (error) {
        if (!pending.signal.aborted) {
          setListing({ directory, entries: [], failure: reasonFrom(error) });
        }
      }
    };

    void load();

    return () => {
      pending.abort();
    };
  }, [directory]);

  const current = listing.directory === directory ? listing : null;

  const entries = current === null ? null : current.entries;

  const rows = useMemo(() => {
    if (entries === null) {
      return [];
    }

    const parent = parentEntry(directory);

    return parent === null ? entries : [parent, ...entries];
  }, [directory, entries]);

  // The cursor is reset when a folder is opened, but a listing that shrinks under it
  // would otherwise leave it pointing past the end.
  const row = Math.min(cursor, Math.max(0, rows.length - 1));

  const openDirectory = (next: string) => {
    setDirectory(next);
    setCursor(0);
  };

  // Held keys arrive faster than Ink redraws, so the step is taken against the value
  // React holds rather than the one this render happens to be showing.
  const moveCursor = (step: number) => {
    const last = Math.max(0, rows.length - 1);

    setCursor((held) => Math.min(Math.max(0, Math.min(held, last) + step), last));
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    // Ctrl chords belong to the app above, which owns quitting, so they must not
    // fall through to the single letter shortcuts below.
    if (key.ctrl) {
      return;
    }

    if (input === "q") {
      onCancel();
      return;
    }

    if (key.upArrow || input === "k") {
      moveCursor(-1);
      return;
    }

    if (key.downArrow || input === "j") {
      moveCursor(1);
      return;
    }

    if (key.leftArrow || input === "h") {
      const parent = dirname(directory);

      if (parent !== directory) {
        openDirectory(parent);
      }

      return;
    }

    const focused = rows[row];

    if (input === " ") {
      if (focused === undefined || focused.isDirectory || !focused.supported) {
        return;
      }

      setPicked((chosen) => {
        const next = new Set(chosen);

        if (next.has(focused.path)) {
          next.delete(focused.path);
        } else {
          next.add(focused.path);
        }

        return next;
      });

      return;
    }

    if (key.rightArrow || input === "l") {
      if (focused !== undefined && focused.isDirectory) {
        openDirectory(focused.path);
      }

      return;
    }

    if (!key.return) {
      return;
    }

    if (focused !== undefined && focused.isDirectory) {
      openDirectory(focused.path);
      return;
    }

    if (picked.size > 0) {
      onConfirm([...picked]);
    }
  });

  const start = windowStart(row, rows.length);
  const visible = rows.slice(start, start + VISIBLE_ROWS);
  const nameWidth = Math.max(12, columns - 24);

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Pick the files to redact</Text>

        <Text dimColor>{truncateStart(directory, Math.max(20, columns - 2))}</Text>
      </Box>

      <Box flexDirection="column">
        {entries === null ? <Text>Reading the folder…</Text> : null}

        {current === null || current.failure === null ? null : (
          <Text>{`This folder could not be read: ${current.failure}`}</Text>
        )}

        {visible.map((entry, index) => {
          const focused = start + index === row;
          const label = entry.isDirectory ? `${entry.name}/` : entry.name;
          const suffix = !entry.isDirectory && !entry.supported ? "  unsupported" : "";

          return (
            <Text bold={focused} key={entry.path}>
              {`${focused ? ">" : " "} ${markerFor(entry, picked.has(entry.path))} ${truncateEnd(label, nameWidth)}${suffix}`}
            </Text>
          );
        })}

        {entries !== null && rows.length === 0 ? <Text>This folder is empty.</Text> : null}

        {rows.length > VISIBLE_ROWS ? (
          <Text dimColor>{`Showing ${start + 1}–${start + visible.length} of ${rows.length}`}</Text>
        ) : null}
      </Box>

      <Box flexDirection="column">
        <Text>
          {picked.size === 0
            ? "Nothing picked yet."
            : `${picked.size} picked. Press enter to redact them.`}
        </Text>

        <Text dimColor>{LEGEND}</Text>

        <Text dimColor>{HELP}</Text>
      </Box>
    </Box>
  );
};

export { FileBrowser };

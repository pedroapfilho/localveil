import { dirname } from "node:path";

import { describeError } from "@repo/redact-core";
import { Box, Text, useInput, useWindowSize } from "ink";
import { useEffect, useMemo, useState } from "react";

import type { DirectoryEntry } from "./entries";
import { parentEntry, readDirectory } from "./entries";
import { truncateEnd, truncateStart } from "./text";

const VISIBLE_ROWS = 10;

const LEGEND = "[x] picked  [ ] pick with space  [-] unsupported  [>] folder";

const HELP = "up/down move  space pick  enter open folder or confirm  esc quit";

const NO_SELECTION: ReadonlyArray<string> = [];

type Listing = { directory: string } & (
  | { entries: Array<DirectoryEntry>; status: "ready" }
  | { reason: string; status: "failed" }
  | { status: "reading" }
);

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

  const [listing, setListing] = useState<Listing>(() => ({
    directory: initialDirectory,
    status: "reading",
  }));

  useEffect(() => {
    const pending = new AbortController();

    const load = async () => {
      try {
        const found = await readDirectory(directory);

        if (!pending.signal.aborted) {
          setListing({ directory, entries: found, status: "ready" });
        }
      } catch (error) {
        if (!pending.signal.aborted) {
          setListing({ directory, reason: describeError(error), status: "failed" });
        }
      }
    };

    void load();

    return () => {
      pending.abort();
    };
  }, [directory]);

  const current = listing.directory === directory ? listing : { status: "reading" as const };

  const entries = current.status === "ready" ? current.entries : undefined;

  const rows = useMemo(() => {
    if (entries === undefined) {
      return [];
    }

    const parent = parentEntry(directory);

    return parent === null ? entries : [parent, ...entries];
  }, [directory, entries]);

  const row = Math.min(cursor, Math.max(0, rows.length - 1));

  const openDirectory = (next: string) => {
    setDirectory(next);
    setCursor(0);
  };

  const moveCursor = (step: number) => {
    const last = Math.max(0, rows.length - 1);

    setCursor((held) => Math.min(Math.max(0, Math.min(held, last) + step), last));
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

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
        {current.status === "reading" ? <Text>Reading the folder…</Text> : null}

        {current.status === "failed" ? (
          <Text>{`This folder could not be read: ${current.reason}`}</Text>
        ) : null}

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

        {current.status === "ready" && rows.length === 0 ? (
          <Text>This folder is empty.</Text>
        ) : null}

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

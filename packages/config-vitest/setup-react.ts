import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node ships its own `localStorage` global that stays undefined without
// --localstorage-file, and it shadows the one jsdom installs, so storage-backed
// code has nothing to talk to. This puts a working store back in that slot.
const installLocalStorage = () => {
  if (window.localStorage !== undefined) {
    return;
  }

  const entries = new Map<string, string>();

  const storage = {
    clear: () => {
      entries.clear();
    },
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };

  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
};

installLocalStorage();

afterEach(() => {
  cleanup();
});

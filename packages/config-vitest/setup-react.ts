import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const hasLocalStorage = ({ localStorage }: { localStorage?: Storage }) =>
  localStorage !== undefined;

const installLocalStorage = () => {
  if (hasLocalStorage(window)) {
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

import { describe, expect, it, vi } from "vitest";

import type { Detect, Span } from "./types";
import { verifyOutput } from "./verify";

const finding = (target: string, score = 0.9): Detect =>
  vi.fn((text: string) => {
    const start = text.indexOf(target);

    return Promise.resolve<Array<Span>>(
      start === -1 ? [] : [{ end: start + target.length, label: "private_person", score, start }],
    );
  });

describe("verifyOutput", () => {
  it("keeps the warnings it was given when the detector finds nothing", async () => {
    expect(
      await verifyOutput("Invoice total due", finding("Ana Lima"), ["warning.scannedPages"]),
    ).toEqual(["warning.scannedPages"]);
  });

  it("warns when the detector still recognises something in what stayed visible", async () => {
    expect(
      await verifyOutput("Signed by Ana Lima", finding("Ana Lima"), ["warning.scannedPages"]),
    ).toEqual(["warning.scannedPages", "warning.notFullyRedacted"]);
  });

  it("does not warn about a span under the apply floor", async () => {
    expect(await verifyOutput("Maybe Name stayed", finding("Name", 0.2), [])).toEqual([]);
  });

  it("skips the detector entirely on text with nothing in it", async () => {
    const detect = finding("Ana Lima");

    expect(await verifyOutput("   ", detect, [])).toEqual([]);
    expect(detect).not.toHaveBeenCalled();
  });
});

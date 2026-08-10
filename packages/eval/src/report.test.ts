import { describe, expect, it } from "vitest";

import { table } from "./report.ts";

const rows = [
  { counts: { falseNegative: 1, falsePositive: 1, truePositive: 3 }, name: "private_person" },
  { counts: { falseNegative: 0, falsePositive: 0, truePositive: 2 }, name: "secret" },
];

describe("table", () => {
  it("puts the title first and a rule under the header", () => {
    const lines = table("Detection", rows).split("\n");

    expect(lines[0]).toBe("Detection");
    expect(lines[1]).toMatch(/^label\s+prec\s+rec\s+f1\s+tp\s+fp\s+fn$/v);
    expect(lines[2]).toMatch(/^-+$/v);
  });

  it("writes one line per row", () => {
    expect(table("Detection", rows).split("\n")).toHaveLength(5);
  });

  it("reports the percentages to one decimal", () => {
    const lines = table("Detection", rows).split("\n");

    expect(lines[3]).toContain(" 75.0");
    expect(lines[4]).toContain("100.0");
  });

  it("pads the label column to the widest name", () => {
    const lines = table("Detection", rows).split("\n");

    expect(lines[3]?.indexOf(" ")).toBe("private_person".length);
    expect(lines[4]?.startsWith("secret        ")).toBe(true);
  });

  it("keeps a rule as wide as the header", () => {
    const lines = table("Detection", rows).split("\n");

    expect(lines[2]).toHaveLength(lines[1]?.length ?? 0);
  });

  it("survives a label with nothing counted against it", () => {
    const empty = [{ counts: { falseNegative: 0, falsePositive: 0, truePositive: 0 }, name: "x" }];

    expect(table("Detection", empty)).toContain("100.0");
  });
});

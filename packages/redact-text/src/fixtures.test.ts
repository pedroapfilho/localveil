import { readFileSync } from "node:fs";

import type { Detect, Span } from "@repo/redact-core";
import { redactFile } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import { textRedactor } from "./index.ts";

const PII = [
  "John Smith",
  "Maria Garcia",
  "john.smith@example.com",
  "maria.garcia@example.com",
  "555-0100",
  "555-0181",
  "42 Oak Street",
  "14 March 2024",
];

const LABELS: Record<string, Span["label"]> = {
  "14 March 2024": "private_date",
  "42 Oak Street": "private_address",
  "555-0100": "private_phone",
  "555-0181": "private_phone",
  "john.smith@example.com": "private_email",
  "John Smith": "private_person",
  "maria.garcia@example.com": "private_email",
  "Maria Garcia": "private_person",
};

const detectKnown: Detect = (text) => {
  const spans: Array<Span> = [];

  for (const needle of PII) {
    let at = text.indexOf(needle);

    while (at !== -1) {
      spans.push({ end: at + needle.length, label: LABELS[needle], score: 0.99, start: at });
      at = text.indexOf(needle, at + needle.length);
    }
  }

  return Promise.resolve(spans.toSorted((left, right) => left.start - right.start));
};

const FIXTURES = [
  { name: "sample.txt", type: "text/plain" },
  { name: "sample.md", type: "text/markdown" },
  { name: "sample.csv", type: "text/csv" },
  { name: "sample.json", type: "application/json" },
  { name: "sample.log", type: "" },
] as const;

const bytesOf = (name: string) =>
  // oxlint-disable-next-line node/no-sync
  readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url));

const fixture = ({ name, type }: { name: string; type: string }) =>
  new File([bytesOf(name)], name, { type });

const noProgress = () => undefined;

describe.each(FIXTURES)("$name", (entry) => {
  const file = fixture(entry);

  it("is accepted", () => {
    expect(textRedactor.accepts(file)).toBe(true);
  });

  it("holds the personal data the fixture was written around", async () => {
    const source = await file.text();

    for (const needle of PII) {
      expect(source).toContain(needle);
    }
  });

  it("comes back with none of it", async () => {
    const result = await redactFile({
      detect: detectKnown,
      file,
      onProgress: noProgress,
      redactor: textRedactor,
    });
    const redacted = await result.blob.text();

    for (const needle of PII) {
      expect(redacted).not.toContain(needle);
    }
  });

  it("reports what it covered and keeps the rest of the file", async () => {
    const result = await redactFile({
      detect: detectKnown,
      file,
      onProgress: noProgress,
      redactor: textRedactor,
    });
    const redacted = await result.blob.text();

    expect(result.redactionCount).toBeGreaterThan(0);
    expect(redacted).toContain("█");
    expect(redacted.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });
});

describe("textRedactor", () => {
  it("leaves a PDF to the PDF redactor", () => {
    expect(textRedactor.accepts(fixture({ name: "sample.pdf", type: "application/pdf" }))).toBe(
      false,
    );
  });

  it("leaves an image to the image redactor", () => {
    expect(textRedactor.accepts(fixture({ name: "sample.png", type: "image/png" }))).toBe(false);
  });
});

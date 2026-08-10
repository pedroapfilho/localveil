import type { Detect, Span } from "@repo/redact-core";
import { describe, expect, it, vi } from "vitest";

import { textRedactor } from "./index.ts";

const span = (start: number, end: number): Span => ({
  end,
  label: "private_person",
  score: 0.9,
  start,
});

const detecting =
  (spans: Array<Span>): Detect =>
  () =>
    Promise.resolve(spans);

const answering = (...replies: Array<Array<Span>>): Detect => {
  const queue = [...replies];

  return () => Promise.resolve(queue.shift() ?? []);
};

const noProgress = () => undefined;

const file = (name: string, type: string, content = "Hi Ana!") =>
  new File([content], name, { type });

describe("textRedactor.accepts", () => {
  it("accepts the supported extensions", () => {
    for (const name of ["a.txt", "b.md", "c.csv", "d.json", "e.log"]) {
      expect(textRedactor.accepts(file(name, ""))).toBe(true);
    }
  });

  it("accepts any text/* MIME type", () => {
    expect(textRedactor.accepts(file("notes", "text/plain"))).toBe(true);
  });

  it("rejects an image", () => {
    expect(textRedactor.accepts(file("scan.png", "image/png"))).toBe(false);
  });

  it("ignores extension case", () => {
    expect(textRedactor.accepts(file("REPORT.TXT", ""))).toBe(true);
  });
});

describe("textRedactor.redact", () => {
  it("masks the detected spans and counts them", async () => {
    const result = await textRedactor.redact(
      file("a.txt", "text/plain"),
      detecting([span(3, 6)]),
      noProgress,
    );

    await expect(result.blob.text()).resolves.toBe("Hi ███!");
    expect(result.redactionCount).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("covers a CSV column the model walked past", async () => {
    const result = await textRedactor.redact(
      file("people.csv", "text/csv", "nome,sku\nAna Lima,X-1"),
      detecting([]),
      noProgress,
    );

    await expect(result.blob.text()).resolves.toBe("nome,sku\n████████,X-1");
  });

  it("covers a JSON value the model walked past", async () => {
    const result = await textRedactor.redact(
      file("payload.json", "application/json", '{"senha": "hunter2"}'),
      detecting([]),
      noProgress,
    );

    await expect(result.blob.text()).resolves.toBe('{"senha": "███████"}');
  });

  it("leaves a log file on the prose path", async () => {
    const result = await textRedactor.redact(
      file("app.log", "", "nome,sku\nAna Lima,X-1"),
      detecting([]),
      noProgress,
    );

    await expect(result.blob.text()).resolves.toBe("nome,sku\nAna Lima,X-1");
  });

  it("warns when personal data is still readable in the masked output", async () => {
    const result = await textRedactor.redact(
      file("a.txt", "text/plain"),
      answering([span(0, 2)], [span(3, 6)]),
      noProgress,
    );

    await expect(result.blob.text()).resolves.toBe("██ Ana!");
    expect(result.warnings).toEqual(["warning.notFullyRedacted"]);
  });

  it("says nothing when the mask covered what the detector goes on to find", async () => {
    const result = await textRedactor.redact(
      file("a.txt", "text/plain"),
      answering([span(3, 6)], [span(3, 6)]),
      noProgress,
    );

    await expect(result.blob.text()).resolves.toBe("Hi ███!");
    expect(result.warnings).toEqual([]);
  });

  it("counts overlapping spans as the one redaction they become", async () => {
    const result = await textRedactor.redact(
      file("a.txt", "text/plain", "Hi Ana Silva!"),
      detecting([span(3, 6), span(4, 12)]),
      noProgress,
    );

    expect(result.redactionCount).toBe(1);
  });

  it("keeps the original MIME type on the returned blob", async () => {
    const result = await textRedactor.redact(file("a.csv", "text/csv"), detecting([]), noProgress);

    expect(result.blob.type).toBe("text/csv");
  });

  it("warns instead of failing on an empty file", async () => {
    const detect = vi.fn<Detect>(() => Promise.resolve([]));
    const result = await textRedactor.redact(file("a.txt", "text/plain", ""), detect, noProgress);

    expect(result.warnings).toEqual(["warning.noText"]);
    expect(result.redactionCount).toBe(0);
    expect(detect).not.toHaveBeenCalled();
  });

  it("reports progress from start to finish", async () => {
    const seen: Array<number> = [];

    await textRedactor.redact(file("a.txt", "text/plain"), detecting([]), (fraction) => {
      seen.push(fraction);
    });

    expect(seen.at(0)).toBe(0);
    expect(seen.at(-1)).toBe(1);
  });
});

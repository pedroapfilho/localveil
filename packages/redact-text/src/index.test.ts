import type { Detect, Span } from "@repo/redact-core";
import { redactFile } from "@repo/redact-core";
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

describe("textRedactor", () => {
  it("masks the detected spans and counts them", async () => {
    const result = await redactFile({
      detect: detecting([span(3, 6)]),
      file: file("a.txt", "text/plain"),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    await expect(result.blob.text()).resolves.toBe("Hi ███!");
    expect(result.redactionCount).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("covers a CSV column the model walked past", async () => {
    const result = await redactFile({
      detect: detecting([]),
      file: file("people.csv", "text/csv", "nome,sku\nAna Lima,X-1"),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    await expect(result.blob.text()).resolves.toBe("nome,sku\n████████,X-1");
  });

  it("covers a JSON value the model walked past", async () => {
    const result = await redactFile({
      detect: detecting([]),
      file: file("payload.json", "application/json", '{"senha": "hunter2"}'),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    await expect(result.blob.text()).resolves.toBe('{"senha": "███████"}');
  });

  it("leaves a log file on the prose path", async () => {
    const result = await redactFile({
      detect: detecting([]),
      file: file("app.log", "", "nome,sku\nAna Lima,X-1"),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    await expect(result.blob.text()).resolves.toBe("nome,sku\nAna Lima,X-1");
  });

  it("does not report a CSV column name as a surviving detection", async () => {
    const result = await redactFile({
      detect: answering([span(9, 17)], [span(0, 4)]),
      file: file("people.csv", "text/csv", "sku,city\nAna Lima,Recife"),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    expect(result.warnings).toEqual([]);
  });

  it("still reports something that survives in a CSV row", async () => {
    const result = await redactFile({
      detect: answering([span(9, 12)], [span(4, 8)]),
      file: file("people.csv", "text/csv", "sku,city\nAna Lima,Recife"),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    expect(result.warnings).toEqual(["warning.notFullyRedacted"]);
  });

  it("warns when personal data is still readable in the masked output", async () => {
    const result = await redactFile({
      detect: answering([span(0, 2)], [span(3, 6)]),
      file: file("a.txt", "text/plain"),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    await expect(result.blob.text()).resolves.toBe("██ Ana!");
    expect(result.warnings).toEqual(["warning.notFullyRedacted"]);
  });

  it("says nothing when the mask covered what the detector goes on to find", async () => {
    const result = await redactFile({
      detect: answering([span(3, 6)], [span(3, 6)]),
      file: file("a.txt", "text/plain"),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    await expect(result.blob.text()).resolves.toBe("Hi ███!");
    expect(result.warnings).toEqual([]);
  });

  it("counts overlapping spans as the one redaction they become", async () => {
    const result = await redactFile({
      detect: detecting([span(3, 6), span(4, 12)]),
      file: file("a.txt", "text/plain", "Hi Ana Silva!"),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    expect(result.redactionCount).toBe(1);
  });

  it("keeps the original MIME type on the returned blob", async () => {
    const result = await redactFile({
      detect: detecting([]),
      file: file("a.csv", "text/csv"),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    expect(result.blob.type).toBe("text/csv");
  });

  it("warns instead of failing on an empty file", async () => {
    const detect = vi.fn<Detect>(() => Promise.resolve([]));
    const result = await redactFile({
      detect,
      file: file("a.txt", "text/plain", ""),
      onProgress: noProgress,
      redactor: textRedactor,
    });

    expect(result.warnings).toEqual(["warning.noText"]);
    expect(result.redactionCount).toBe(0);
    expect(detect).not.toHaveBeenCalled();
  });

  it("leaves the file untouched when every detection is dismissed", async () => {
    const source = file("a.txt", "text/plain");
    const analysis = await textRedactor.analyse(source, detecting([span(3, 6)]), noProgress);
    const result = await textRedactor.apply({
      analysis,
      decisions: { dismissed: analysis.detections.map((detection) => detection.id), kept: [] },
      detect: detecting([]),
      file: source,
      onProgress: noProgress,
    });

    await expect(result.blob.text()).resolves.toBe("Hi Ana!");
    expect(result.redactionCount).toBe(0);
  });

  it("previews exactly what it would cover", async () => {
    const analysis = await textRedactor.analyse(
      file("a.txt", "text/plain"),
      detecting([span(3, 6)]),
      noProgress,
    );

    expect(analysis.detections.map((detection) => detection.preview)).toContain("Ana");
  });

  it("covers everything when nothing is dismissed", async () => {
    const source = file("a.txt", "text/plain");
    const analysis = await textRedactor.analyse(source, detecting([span(3, 6)]), noProgress);
    const result = await textRedactor.apply({
      analysis,
      decisions: { dismissed: [], kept: [] },
      detect: detecting([]),
      file: source,
      onProgress: noProgress,
    });

    await expect(result.blob.text()).resolves.toBe("Hi ███!");
  });

  it("survives a round trip through structuredClone, as the worker boundary requires", async () => {
    const analysis = await textRedactor.analyse(
      file("a.txt", "text/plain"),
      detecting([span(3, 6)]),
      noProgress,
    );

    expect(structuredClone(analysis)).toEqual(analysis);
  });

  it("reports progress from start to finish", async () => {
    const seen: Array<number> = [];

    await redactFile({
      detect: detecting([]),
      file: file("a.txt", "text/plain"),
      onProgress: (fraction: number) => {
        seen.push(fraction);
      },
      redactor: textRedactor,
    });

    expect(seen.at(0)).toBe(0);
    expect(seen.at(-1)).toBe(1);
  });
});

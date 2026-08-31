import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Detect } from "@repo/redact-core";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";

import { redactPath } from "./redact-path";

type Placed = { at: [x: number, y: number]; text: string };

const PAGE = { height: 792, width: 612 };

const SIZE = 11;

/* pdf.js hands text back in content-stream order, so writing the stamped values after the blank
   captions reproduces what a signing service leaves behind. */
const pdfWith = async (placed: Array<Placed>) => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([PAGE.width, PAGE.height]);

  for (const { at, text } of placed) {
    sheet.drawText(text, { font, size: SIZE, x: at[0], y: at[1] });
  }

  return document.save();
};

const writtenTo = async (directory: string, name: string, placed: Array<Placed>) => {
  const file = path.join(directory, name);

  await writeFile(file, await pdfWith(placed));

  return file;
};

const readingOf = async (file: string) => {
  const seen: Array<string> = [];
  const record: Detect = (text) => {
    seen.push(text);

    return Promise.resolve([]);
  };

  await redactPath(file, record, () => undefined);

  return seen.at(0) ?? "";
};

describe("a page read through the real text layer", () => {
  let directory = "";

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "localveil-reading-order-"));
  });

  it("puts a stamped value beside the caption it was written onto", async () => {
    const file = await writtenTo(directory, "form.pdf", [
      { at: [72, 720], text: "The parties have executed this agreement on the date below." },
      { at: [72, 640], text: "RECIPIENT:" },
      { at: [72, 560], text: "Name of Recipient (Please Print)" },
      { at: [72, 500], text: "Signature and Title if applicable" },
      { at: [72, 440], text: "Address of Recipient" },
      { at: [72, 580], text: "Ana Lima Ferreira" },
      { at: [300, 580], text: "BRIGHTWATER HOLDINGS LTD" },
    ]);

    const reading = await readingOf(file);

    expect(reading).toContain("Ana Lima Ferreira Name of Recipient");
    expect(reading).not.toContain("Ana Lima Ferreira BRIGHTWATER");
  });

  it("reads a two column page one column at a time", async () => {
    const file = await writtenTo(directory, "columns.pdf", [
      { at: [72, 700], text: "Alpha beta gamma delta" },
      { at: [320, 700], text: "Sigma tau upsilon phi" },
      { at: [72, 680], text: "epsilon zeta eta theta" },
      { at: [320, 680], text: "chi psi omega iota" },
      { at: [72, 660], text: "kappa lambda mu nu" },
      { at: [320, 660], text: "omicron pi rho tau" },
    ]);

    const reading = await readingOf(file);

    expect(reading).toContain("Alpha beta gamma delta epsilon zeta eta theta kappa lambda mu nu");
    expect(reading).toContain("Sigma tau upsilon phi chi psi omega iota omicron pi rho tau");
  });
});

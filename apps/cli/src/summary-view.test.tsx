import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";

import type { RunResult } from "./run-redaction";
import { SummaryView } from "./summary-view";

const emptyResult: RunResult = {
  cancelled: false,
  failures: [],
  fileCount: 0,
  redactionCount: 0,
  warnings: [],
  zipPath: null,
};

const resultWith = (overrides: Partial<RunResult>): RunResult => ({ ...emptyResult, ...overrides });

afterEach(() => {
  cleanup();
});

describe("SummaryView", () => {
  it("prints where the archive landed alongside what went into it", () => {
    const result = resultWith({
      fileCount: 4,
      redactionCount: 27,
      zipPath: "/home/ada/localveil.zip",
    });

    const { lastFrame } = render(<SummaryView result={result} />);

    expect(lastFrame()).toContain("/home/ada/localveil.zip");
    expect(lastFrame()).toContain("4 files, 27 redactions");
  });

  it("counts a single file and a single redaction without an s", () => {
    const result = resultWith({ fileCount: 1, redactionCount: 1, zipPath: "/tmp/localveil.zip" });

    const { lastFrame } = render(<SummaryView result={result} />);

    expect(lastFrame()).toContain("1 file, 1 redaction");
  });

  it("names every file that came back with a warning and says what it was", () => {
    const result = resultWith({
      fileCount: 1,
      warnings: [{ keys: ["warning.lowConfidence"], name: "scan.pdf" }],
      zipPath: "/tmp/localveil.zip",
    });

    const { lastFrame } = render(<SummaryView result={result} />);

    expect(lastFrame()).toContain("Warnings (1)");
    expect(lastFrame()).toContain("scan.pdf");
    expect(lastFrame()).toContain("Some text was hard to read");
    expect(lastFrame()).not.toContain("warning.lowConfidence");
  });

  it("lists the files it could not redact next to the reason each one gave", () => {
    const result = resultWith({
      failures: [{ name: "broken.pdf", reason: "The page tree could not be read" }],
      fileCount: 2,
      redactionCount: 5,
      zipPath: "/tmp/localveil.zip",
    });

    const { lastFrame } = render(<SummaryView result={result} />);

    expect(lastFrame()).toContain("Could not redact (1)");
    expect(lastFrame()).toContain("broken.pdf");
    expect(lastFrame()).toContain("The page tree could not be read");
  });

  it("says plainly that a stopped run wrote nothing", () => {
    const { lastFrame } = render(<SummaryView result={resultWith({ cancelled: true })} />);

    expect(lastFrame()).toContain("Stopped, so no archive was written.");
  });

  it("says nothing about an archive when every file failed", () => {
    const result = resultWith({
      failures: [{ name: "broken.pdf", reason: "Unsupported file" }],
    });

    const { lastFrame } = render(<SummaryView result={result} />);

    expect(lastFrame()).toContain("No archive was written.");
    expect(lastFrame()).toContain("0 files, 0 redactions");
  });
});

import type { ModelLoadState } from "@repo/pii-detect/models";
import type { FileStageKey } from "@repo/redact-core";
import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";

import { ProgressView } from "./progress-view";

const defaults = {
  fileIndex: 1,
  fileName: "invoice.pdf",
  fraction: 0.42,
  model: { kind: "ready" } as ModelLoadState,
  stage: "stage.detecting" as FileStageKey | null,
  stopping: false,
  total: 3,
};

afterEach(() => {
  cleanup();
});

describe("ProgressView", () => {
  it("puts a number on the bar rather than leaving the length to say it", () => {
    const { lastFrame } = render(<ProgressView {...defaults} />);

    expect(lastFrame()).toContain("42%");
    expect(lastFrame()).toContain("#");
  });

  it("counts the file being worked on from one, the way a person would", () => {
    const { lastFrame } = render(<ProgressView {...defaults} />);

    expect(lastFrame()).toContain("File 2 of 3");
    expect(lastFrame()).toContain("invoice.pdf");
  });

  it("spells the stage out in words instead of showing its key", () => {
    const { lastFrame } = render(<ProgressView {...defaults} />);

    expect(lastFrame()).toContain("Looking for personal data");
    expect(lastFrame()).not.toContain("stage.detecting");
  });

  it("shows the download while the model is still arriving", () => {
    const { lastFrame } = render(
      <ProgressView {...defaults} model={{ downloaded: 0.1, kind: "loading" }} />,
    );

    expect(lastFrame()).toContain("Downloading the detection model");
    expect(lastFrame()).toContain("Downloaded once");
    expect(lastFrame()).toContain("10%");
  });

  it("drops the download once the model is in hand", () => {
    const { lastFrame } = render(<ProgressView {...defaults} />);

    expect(lastFrame()).not.toContain("Downloading the detection model");
  });

  it("says a stop is immediate and leaves no archive", () => {
    const { lastFrame } = render(<ProgressView {...defaults} stopping />);

    expect(lastFrame()).toContain("Stopping now, so no archive will be written.");
  });
});

/* oxlint-disable anti-slop/no-module-mocking -- runRedaction drives the model runtime and worker threads; the module seam is the only practical hermetic substitute */
import type { ModelLoadEvent } from "@repo/pii-detect/models";
import { cleanup, render } from "ink-testing-library";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProgressView } from "./progress-view";
import { useRedactionRun } from "./use-redaction-run";

const { runRedaction } = vi.hoisted(() => ({ runRedaction: vi.fn() }));

vi.mock("./run-redaction", () => ({ runRedaction }));

const loadThrough = (events: ReadonlyArray<ModelLoadEvent>) => {
  runRedaction.mockImplementation(
    ({ onModelLoad }: { onModelLoad: (event: ModelLoadEvent) => void }) => {
      for (const event of events) {
        onModelLoad(event);
      }

      return new Promise(() => {});
    },
  );
};

const Run = () => {
  const { progress, start } = useRedactionRun({ onSettled: () => undefined, outputDirectory: "." });

  useEffect(() => {
    start(["one.txt"]);
  }, [start]);

  return (
    <ProgressView
      fileIndex={progress.fileIndex}
      fileName="one.txt"
      fraction={progress.fraction}
      model={progress.model}
      stage={progress.stage}
      stopping={false}
      total={1}
    />
  );
};

afterEach(() => {
  cleanup();
  runRedaction.mockReset();
});

describe("a run loading its model", () => {
  it("shows no download bar for a model already kept, and no GPU notice it cannot act on", async () => {
    loadThrough([{ kind: "loading" }, { kind: "slow-device" }]);

    const { lastFrame } = render(<Run />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("File 1 of 1");
    });
    expect(lastFrame()).not.toContain("Running without GPU acceleration");
    expect(lastFrame()).not.toContain("Downloading the detection model");
    expect(lastFrame()?.match(/%/gv)).toHaveLength(1);
  });

  it("shows the download while the weights arrive", async () => {
    loadThrough([{ kind: "loading" }, { downloaded: 0.3, kind: "loading" }]);

    const { lastFrame } = render(<Run />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Downloading the detection model");
    });
    expect(lastFrame()).toContain("30%");
  });
});

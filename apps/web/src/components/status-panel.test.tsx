import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Job } from "../store";
import { renderWithI18n } from "../test-utils";
import type { ModelState } from "../use-redaction";

import { StatusPanel } from "./status-panel";

const model = (patch: Partial<ModelState> = {}): ModelState => ({
  fraction: 0,
  slowDevice: false,
  ...patch,
});

const job = (patch: Partial<Job> = {}): Job => ({
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  progress: 0,
  run: 0,
  status: "queued",
  ...patch,
});

const result = { blob: new Blob(["hi"]), redactionCount: 2, warnings: [] };

const setup = (jobs: Array<Job>, state: ModelState = model()) =>
  renderWithI18n(<StatusPanel jobs={jobs} model={state} />);

const SLOW = "Running without GPU acceleration, this will be slow.";

describe("StatusPanel", () => {
  it("rests with a line and an empty bar when nothing is happening", () => {
    setup([]);

    expect(screen.getByText("Nothing running")).toBeInTheDocument();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("reports the model download with its percentage", () => {
    setup([job()], model({ fraction: 0.42, stage: "model.downloading" }));

    expect(screen.getByText("Downloading the detection model")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  // A cached model reports 100% and then spends seconds building a session, which is
  // not a download and must not claim to be one.
  it("stops calling it a download once every byte is in hand", () => {
    setup([job()], model({ fraction: 1, stage: "model.downloading" }));

    expect(screen.getByText("Loading the detection model")).toBeInTheDocument();
    expect(screen.queryByText("Downloading the detection model")).toBeNull();
  });

  it("shows the running file's stage and the tally once the model is out of the way", () => {
    setup(
      [
        job({ progress: 1, result, status: "done" }),
        job({ id: "job-2", progress: 0.5, stage: "stage.redacting", status: "running" }),
      ],
      model({ fraction: 1, stage: "model.ready" }),
    );

    expect(screen.getByText("Redacting")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 redacted")).toBeInTheDocument();
  });

  it("says it finished once every file has settled", () => {
    setup(
      [job({ progress: 1, result, status: "done" })],
      model({ fraction: 1, stage: "model.ready" }),
    );

    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 redacted")).toBeInTheDocument();
  });

  it("leaves a failed file out of the tally", () => {
    setup(
      [
        job({ error: "boom", status: "error" }),
        job({ id: "job-2", progress: 1, result, status: "done" }),
      ],
      model({ fraction: 1, stage: "model.ready" }),
    );

    expect(screen.getByText("1 of 2 redacted")).toBeInTheDocument();
  });

  it("warns about a slow device while there is work on the page", () => {
    setup([job()], model({ slowDevice: true, stage: "model.downloading" }));

    expect(screen.getByText(SLOW)).toBeInTheDocument();
  });

  it("keeps the slow device warning off the resting panel", () => {
    setup([], model({ slowDevice: true }));

    expect(screen.queryByText(SLOW)).toBeNull();
  });
});

describe("with motion allowed", () => {
  it("animates the slow device line open by its height", () => {
    setup([job()], model({ slowDevice: true, stage: "model.downloading" }));

    expect(screen.getByText(SLOW).parentElement?.style.height).not.toBe("");
  });
});

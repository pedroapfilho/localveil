import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Job } from "../store";
import { renderWithI18n } from "../test-utils";
import type { ModelState } from "../use-redaction";

import { StatusPanel } from "./status-panel";

const model = (patch: Partial<ModelState> = {}): ModelState => ({ fraction: 0, ...patch });

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

const bar = () => screen.getByRole("progressbar", { name: "Redaction progress" });

describe("StatusPanel", () => {
  // Only the bar. The stage names that used to sit above it changed eight times per
  // file, and each of them is still on that file's own row.
  it("says nothing in words", () => {
    const { container } = setup([job({ stage: "stage.redacting", status: "running" })]);

    expect(container.querySelector("p")).toBeNull();
    expect(screen.queryByText("Redacting")).toBeNull();
  });

  it("fades out and leaves the tree when there is nothing to report", () => {
    setup([]);

    const track = screen.getByRole("progressbar", { hidden: true });

    expect(track.className).toContain("opacity-0");
    expect(track.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows itself once a file is waiting", () => {
    setup([job()]);

    expect(bar().className).toContain("opacity-100");
  });

  it("counts the model download as part of the whole job", () => {
    setup([job()], model({ fraction: 0.42, stage: "model.downloading" }));

    // Half of one bar shared with one file, not 42% of a bar that will restart.
    expect(bar().getAttribute("aria-valuenow")).toBe("21");
  });

  it("fills as the files behind the model finish", () => {
    setup(
      [
        job({ progress: 1, result, status: "done" }),
        job({ id: "job-2", progress: 0.5, status: "running" }),
      ],
      model({ fraction: 1, stage: "model.ready" }),
    );

    expect(bar().getAttribute("aria-valuenow")).toBe("75");
  });

  it("stays full once every file has settled", () => {
    setup(
      [job({ progress: 1, result, status: "done" })],
      model({ fraction: 1, stage: "model.ready" }),
    );

    expect(bar().getAttribute("aria-valuenow")).toBe("100");
  });
});

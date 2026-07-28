import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../store";
import { renderWithI18n } from "../test-utils";

import { JobList } from "./job-list";

const job = (patch: Partial<Job> = {}): Job => ({
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  progress: 0,
  status: "queued",
  ...patch,
});

const setup = (jobs: Array<Job>) => {
  const onRemove = vi.fn<(id: string) => void>();

  renderWithI18n(<JobList jobs={jobs} onRemove={onRemove} />);

  return { onRemove };
};

describe("JobList", () => {
  it("renders nothing at all with no files", () => {
    setup([]);

    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("counts the files it is showing", () => {
    setup([job(), job({ id: "job-2" })]);

    expect(screen.getByRole("heading", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("names each file and its status", () => {
    setup([job(), job({ id: "job-2", status: "running" })]);

    expect(screen.getAllByText("notes.txt").length).toBe(2);
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("shows progress and the current stage while a file is running", () => {
    setup([job({ progress: 0.8, stage: "stage.redacting", status: "running" })]);

    const bar = screen.getByRole("progressbar", { name: "notes.txt" });

    expect(bar.getAttribute("aria-valuenow")).toBe("80");
    expect(screen.getByText("Redacting")).toBeInTheDocument();
  });

  it("drops the progress bar once a file has settled", () => {
    setup([
      job({
        progress: 1,
        result: { blob: new Blob(["hi"]), redactionCount: 3, warnings: [] },
        status: "done",
      }),
    ]);

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("reports how many spans were redacted", () => {
    setup([
      job({
        result: { blob: new Blob(["hi"]), redactionCount: 3, warnings: [] },
        status: "done",
      }),
    ]);

    expect(screen.getByText("3 redacted")).toBeInTheDocument();
  });

  it("says so when a clean file had nothing to redact", () => {
    setup([
      job({
        result: { blob: new Blob(["hi"]), redactionCount: 0, warnings: [] },
        status: "done",
      }),
    ]);

    expect(screen.getByText("Nothing found to redact")).toBeInTheDocument();
  });

  it("shows the failure reason on a failed file", () => {
    setup([job({ error: "The worker gave up", status: "error" })]);

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("The worker gave up")).toBeInTheDocument();
  });

  it("removes the file it was asked to remove", () => {
    const { onRemove } = setup([job(), job({ id: "job-2" })]);

    fireEvent.click(screen.getAllByLabelText("Remove notes.txt")[1]);

    expect(onRemove).toHaveBeenCalledWith("job-2");
  });
});

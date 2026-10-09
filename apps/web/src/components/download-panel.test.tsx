import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../store";
import { jobOf, renderWithI18n } from "../test-utils";

import { DownloadPanel } from "./download-panel";

const done = jobOf({
  phase: "done",
  result: { blob: new Blob(["hi"]), redactionCount: 1, warnings: [] },
});

const failed = jobOf({ error: "boom", phase: "error" }, { id: "job-2" });

const setup = (jobs: Array<Job>) => {
  const onDownload = vi.fn<() => void>();

  renderWithI18n(<DownloadPanel jobs={jobs} onDownload={onDownload} />);

  return { onDownload };
};

const theButton = () => screen.getByRole("button");

describe("DownloadPanel", () => {
  it("renders nothing before there is a file to download", () => {
    setup([]);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays disabled while the first file is still queued", () => {
    setup([jobOf()]);

    expect(theButton()).toBeDisabled();
  });

  it("stays disabled while a file is still running", () => {
    setup([done, jobOf({ phase: "queued" }, { id: "job-2" })]);

    expect(theButton()).toBeDisabled();
  });

  it("counts only the files that produced something", () => {
    setup([done, failed]);

    expect(theButton()).toHaveTextContent("Download ZIP (1)");
  });

  it("says how many files were left out", () => {
    setup([done, failed]);

    expect(screen.getByText("1 files were left out because they failed.")).toBeInTheDocument();
  });

  it("hands the download over when clicked", () => {
    const { onDownload } = setup([done]);

    fireEvent.click(theButton());

    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});

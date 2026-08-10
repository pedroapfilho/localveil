import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../store";
import { renderWithI18n } from "../test-utils";

import { DownloadPanel } from "./download-panel";

const result = { blob: new Blob(["hi"]), redactionCount: 1, warnings: [] };

const job = (patch: Partial<Job> = {}): Job => ({
  dismissed: [],
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  progress: 0,
  status: "queued",
  ...patch,
});

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
    setup([job()]);

    expect(theButton()).toBeDisabled();
  });

  it("stays disabled while a file is still running", () => {
    setup([job({ result, status: "done" }), job({ id: "job-2" })]);

    expect(theButton()).toBeDisabled();
  });

  it("counts only the files that produced something", () => {
    setup([job({ result, status: "done" }), job({ error: "boom", id: "job-2", status: "error" })]);

    expect(theButton()).toHaveTextContent("Download ZIP (1)");
  });

  it("says how many files were left out", () => {
    setup([job({ result, status: "done" }), job({ error: "boom", id: "job-2", status: "error" })]);

    expect(screen.getByText("1 files were left out because they failed.")).toBeInTheDocument();
  });

  it("hands the download over when clicked", () => {
    const { onDownload } = setup([job({ result, status: "done" })]);

    fireEvent.click(theButton());

    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});

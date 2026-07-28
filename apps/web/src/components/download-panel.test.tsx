import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../store";
import { renderWithI18n } from "../test-utils";

import { DownloadPanel } from "./download-panel";

const result = { blob: new Blob(["hi"]), redactionCount: 1, warnings: [] };

const job = (patch: Partial<Job> = {}): Job => ({
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  progress: 0,
  status: "queued",
  ...patch,
});

const setup = (jobs: Array<Job>) => {
  const onDownload = vi.fn<() => void>();

  renderWithI18n(<DownloadPanel jobs={jobs} onDownload={onDownload} />);

  return { button: screen.getByRole("button"), onDownload };
};

describe("DownloadPanel", () => {
  it("stays disabled with nothing to download", () => {
    const { button } = setup([]);

    expect(button).toBeDisabled();
    expect(screen.getByText("Redact a file to enable the download.")).toBeInTheDocument();
  });

  it("stays disabled while a file is still running", () => {
    const { button } = setup([job({ result, status: "done" }), job({ id: "job-2" })]);

    expect(button).toBeDisabled();
  });

  it("counts only the files that produced something", () => {
    const { button } = setup([
      job({ result, status: "done" }),
      job({ error: "boom", id: "job-2", status: "error" }),
    ]);

    expect(button).toHaveTextContent("Download ZIP (1)");
  });

  it("says how many files were left out", () => {
    setup([job({ result, status: "done" }), job({ error: "boom", id: "job-2", status: "error" })]);

    expect(screen.getByText("1 files were left out because they failed.")).toBeInTheDocument();
  });

  it("hands the download over when clicked", () => {
    const { button, onDownload } = setup([job({ result, status: "done" })]);

    fireEvent.click(button);

    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});

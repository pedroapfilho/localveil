import type { Analysis, FileStageKey } from "@repo/redact-core";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job, JobResult, JobSource, JobStatus } from "../store";
import { renderWithI18n } from "../test-utils";

import { DownloadPanel } from "./download-panel";

const result = { blob: new Blob(["hi"]), redactionCount: 1, warnings: [] };

type JobPatch = {
  analysis?: Analysis;
  covered?: ReadonlyArray<string>;
  error?: string;
  file?: File;
  id?: string;
  path?: string;
  progress?: number;
  result?: JobResult;
  stage?: FileStageKey;
  status?: JobStatus;
};

const EMPTY_ANALYSIS: Analysis = { detections: [], handle: undefined, warnings: [] };

const EMPTY_RESULT: JobResult = { blob: new Blob([]), redactionCount: 0, warnings: [] };

const jobFrom = (patch: JobPatch, fallbackFile: File, fallbackId: string): Job => {
  const source: JobSource = {
    file: patch.file ?? fallbackFile,
    id: patch.id ?? fallbackId,
    path: patch.path,
  };

  if (patch.status === "done") {
    return { ...source, result: patch.result ?? EMPTY_RESULT, status: "done" };
  }

  if (patch.status === "error") {
    return { ...source, error: patch.error ?? "boom", status: "error" };
  }

  if (patch.status === "running") {
    return { ...source, progress: patch.progress ?? 0, stage: patch.stage, status: "running" };
  }

  if (patch.status === "reviewing") {
    return {
      ...source,
      analysis: patch.analysis ?? EMPTY_ANALYSIS,
      covered: patch.covered ?? [],
      progress: patch.progress ?? 0.5,
      status: "reviewing",
    };
  }

  return { ...source, stage: patch.stage, status: "queued" };
};

const job = (patch: JobPatch = {}): Job =>
  jobFrom(patch, new File(["hello"], "notes.txt", { type: "text/plain" }), "job-1");

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

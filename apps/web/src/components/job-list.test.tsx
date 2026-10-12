import { fireEvent, screen } from "@testing-library/react";
import { assert, describe, expect, it, vi } from "vitest";

import type { Job, JobState } from "../store";
import { jobOf, renderWithI18n } from "../test-utils";

import { JobList } from "./job-list";

const PDF = new File(["%PDF"], "card.pdf", { type: "application/pdf" });

const job = (state?: JobState) => jobOf(state);

const other = jobOf({ phase: "queued" }, { id: "job-2" });

const pdf = (id: string) => jobOf({ phase: "queued" }, { file: PDF, id });

const setup = (jobs: Array<Job>) => {
  const onApply = vi.fn<(id: string, covered: ReadonlyArray<string>) => void>();
  const onClear = vi.fn<() => void>();
  const onCoveredChange = vi.fn<(id: string, covered: ReadonlyArray<string>) => void>();
  const onRemove = vi.fn<(id: string) => void>();
  const onRemoveMany = vi.fn<(ids: ReadonlyArray<string>) => void>();

  const view = renderWithI18n(
    <JobList
      jobs={jobs}
      modelLoading={false}
      onApply={onApply}
      onClear={onClear}
      onCoveredChange={onCoveredChange}
      onRemove={onRemove}
      onRemoveMany={onRemoveMany}
    />,
  );

  const rerenderWith = (next: Array<Job>) => {
    view.rerender(
      <JobList
        jobs={next}
        modelLoading={false}
        onApply={onApply}
        onClear={onClear}
        onCoveredChange={onCoveredChange}
        onRemove={onRemove}
        onRemoveMany={onRemoveMany}
      />,
    );
  };

  return { onClear, onRemove, onRemoveMany, rerenderWith };
};

describe("JobList", () => {
  it("renders nothing at all with no files", () => {
    setup([]);

    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("names each file and its status", () => {
    setup([
      job(),
      jobOf({ phase: "analysing", progress: 0.2, stage: "stage.reading" }, { id: "job-2" }),
    ]);

    expect(screen.getAllByText("notes.txt").length).toBe(2);
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("shows progress and the current stage while a file is running", () => {
    setup([job({ phase: "applying", progress: 0.8, stage: "stage.redacting" })]);

    const bar = screen.getByRole("progressbar", { name: "notes.txt" });

    expect(bar.getAttribute("aria-valuenow")).toBe("80");
    expect(screen.getByText("Redacting")).toBeInTheDocument();
  });

  it("drops the progress bar once a file has settled", () => {
    setup([
      job({ phase: "done", result: { blob: new Blob(["hi"]), redactionCount: 3, warnings: [] } }),
    ]);

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("reports how many spans were redacted", () => {
    setup([
      job({ phase: "done", result: { blob: new Blob(["hi"]), redactionCount: 3, warnings: [] } }),
    ]);

    expect(screen.getByText("3 redacted")).toBeInTheDocument();
  });

  it("says so when a clean file had nothing to redact", () => {
    setup([
      job({ phase: "done", result: { blob: new Blob(["hi"]), redactionCount: 0, warnings: [] } }),
    ]);

    expect(screen.getByText("Nothing found to redact")).toBeInTheDocument();
  });

  it("empties the whole list when asked", () => {
    const { onClear } = setup([job(), other]);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("removes the file it was asked to remove", () => {
    const { onRemove } = setup([job(), other]);

    const [, second] = screen.getAllByLabelText("Remove notes.txt");

    assert.isDefined(second);
    fireEvent.click(second);

    expect(onRemove).toHaveBeenCalledWith("job-2");
  });
});

describe("selecting files", () => {
  it("swaps the heading for a toolbar once a row is picked", () => {
    setup([job(), other]);

    const [first] = screen.getAllByLabelText("Select notes.txt");

    assert.isDefined(first);
    fireEvent.click(first);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  });

  it("picks every row from the header checkbox", () => {
    setup([job(), other]);

    fireEvent.click(screen.getByLabelText("Select all files"));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("hands the whole selection to the bulk remove", () => {
    const { onRemoveMany } = setup([job(), other]);

    fireEvent.click(screen.getByLabelText("Select all files"));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    expect(onRemoveMany).toHaveBeenCalledWith(["job-1", "job-2"]);
  });

  it("forgets a picked row that has left the list", () => {
    const { onRemoveMany, rerenderWith } = setup([job(), other]);

    fireEvent.click(screen.getByLabelText("Select all files"));
    rerenderWith([job()]);

    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    expect(onRemoveMany).toHaveBeenCalledWith(["job-1"]);
  });

  it("removes a whole selection of scans at once", () => {
    const { onRemoveMany } = setup([pdf("job-pdf"), pdf("job-pdf-2")]);

    fireEvent.click(screen.getByLabelText("Select all files"));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    expect(onRemoveMany).toHaveBeenCalledWith(["job-pdf", "job-pdf-2"]);
  });
});

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../store";
import { renderWithI18n } from "../test-utils";

import { JobList } from "./job-list";

const job = (patch: Partial<Job> = {}): Job => ({
  dismissed: [],
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  kept: [],
  progress: 0,
  status: "queued",
  ...patch,
});

const pdf = (patch: Partial<Job> = {}): Job =>
  job({
    file: new File(["%PDF"], "card.pdf", { type: "application/pdf" }),
    id: "job-pdf",
    ...patch,
  });

const setup = (jobs: Array<Job>) => {
  const onApply = vi.fn<(id: string) => void>();
  const onClear = vi.fn<() => void>();
  const onDismissedChange = vi.fn<(id: string, dismissed: ReadonlyArray<string>) => void>();
  const onKeptChange = vi.fn<(id: string, kept: ReadonlyArray<string>) => void>();
  const onLanguage = vi.fn<(ids: ReadonlyArray<string>, language?: "en" | "es" | "pt") => void>();
  const onRemove = vi.fn<(id: string) => void>();
  const onRemoveMany = vi.fn<(ids: ReadonlyArray<string>) => void>();

  const view = renderWithI18n(
    <JobList
      jobs={jobs}
      onApply={onApply}
      onClear={onClear}
      onDismissedChange={onDismissedChange}
      onKeptChange={onKeptChange}
      onLanguage={onLanguage}
      onRemove={onRemove}
      onRemoveMany={onRemoveMany}
    />,
  );

  const rerenderWith = (next: Array<Job>) => {
    view.rerender(
      <JobList
        jobs={next}
        onApply={onApply}
        onClear={onClear}
        onDismissedChange={onDismissedChange}
        onKeptChange={onKeptChange}
        onLanguage={onLanguage}
        onRemove={onRemove}
        onRemoveMany={onRemoveMany}
      />,
    );
  };

  return { onClear, onLanguage, onRemove, onRemoveMany, rerenderWith };
};

describe("JobList", () => {
  it("renders nothing at all with no files", () => {
    setup([]);

    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
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

  it("empties the whole list when asked", () => {
    const { onClear } = setup([job(), job({ id: "job-2" })]);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("removes the file it was asked to remove", () => {
    const { onRemove } = setup([job(), job({ id: "job-2" })]);

    fireEvent.click(screen.getAllByLabelText("Remove notes.txt")[1]);

    expect(onRemove).toHaveBeenCalledWith("job-2");
  });
});

describe("selecting files", () => {
  it("swaps the heading for a toolbar once a row is picked", () => {
    setup([job(), job({ id: "job-2" })]);

    fireEvent.click(screen.getAllByLabelText("Select notes.txt")[0]);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  });

  it("picks every row from the header checkbox", () => {
    setup([job(), job({ id: "job-2" })]);

    fireEvent.click(screen.getByLabelText("Select all files"));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("hands the whole selection to the bulk remove", () => {
    const { onRemoveMany } = setup([job(), job({ id: "job-2" })]);

    fireEvent.click(screen.getByLabelText("Select all files"));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    expect(onRemoveMany).toHaveBeenCalledWith(["job-1", "job-2"]);
  });

  it("forgets a picked row that has left the list", () => {
    const { onRemoveMany, rerenderWith } = setup([job(), job({ id: "job-2" })]);

    fireEvent.click(screen.getByLabelText("Select all files"));
    rerenderWith([job()]);

    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    expect(onRemoveMany).toHaveBeenCalledWith(["job-1"]);
  });

  it("applies a language to the whole selection", async () => {
    const { onLanguage } = setup([pdf(), pdf({ id: "job-pdf-2" })]);

    fireEvent.click(screen.getByLabelText("Select all files"));
    fireEvent.click(screen.getByRole("combobox", { name: "Document language" }));

    const option = await screen.findByRole("option", { name: "Português" });

    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);

    expect(onLanguage).toHaveBeenCalledWith(["job-pdf", "job-pdf-2"], "pt");
  });
});

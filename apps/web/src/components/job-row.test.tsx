import type { Analysis, FileStageKey } from "@repo/redact-core";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job, JobResult, JobSource, JobStatus } from "../store";
import { renderWithI18n } from "../test-utils";

import { JobRow } from "./job-row";

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

const text = (patch: JobPatch = {}): Job =>
  jobFrom(patch, new File(["hello"], "notes.txt", { type: "text/plain" }), "job-1");

const pdf = (patch: JobPatch = {}): Job =>
  text({ file: new File(["%PDF"], "card.pdf", { type: "application/pdf" }), ...patch });

const setup = (job: Job, selected = false) => {
  const onApply = vi.fn<(id: string) => void>();
  const onCoveredChange = vi.fn<(id: string, covered: ReadonlyArray<string>) => void>();
  const onRemove = vi.fn<(id: string) => void>();
  const onSelect = vi.fn<(id: string, next: boolean) => void>();

  const view = renderWithI18n(
    <ul>
      <JobRow
        index={0}
        job={job}
        onApply={onApply}
        onCoveredChange={onCoveredChange}
        onRemove={onRemove}
        onSelect={onSelect}
        selected={selected}
      />
    </ul>,
  );

  const rerenderWith = (next: Job) => {
    view.rerender(
      <ul>
        <JobRow
          index={0}
          job={next}
          onApply={onApply}
          onCoveredChange={onCoveredChange}
          onRemove={onRemove}
          onSelect={onSelect}
          selected={selected}
        />
      </ul>,
    );
  };

  return { container: view.container, onRemove, onSelect, rerenderWith };
};

const LOW_CONFIDENCE =
  "Some text was hard to read, so a little personal data may have been missed.";

describe("JobRow", () => {
  it("reserves no gap around the panel that animates open", () => {
    const { container } = setup(pdf());

    const attachment = container.querySelector('[data-slot="attachment"]');

    expect(attachment?.className).toContain("gap-0");
  });

  it("keeps the warnings behind the disclosure until it is opened", () => {
    setup(
      pdf({
        result: { blob: new Blob(["hi"]), redactionCount: 1, warnings: ["warning.lowConfidence"] },
        status: "done",
      }),
    );

    expect(screen.queryByText(LOW_CONFIDENCE)).toBeNull();

    fireEvent.click(screen.getByLabelText("Details for card.pdf"));

    expect(screen.getByText(LOW_CONFIDENCE)).toBeInTheDocument();
  });

  it("spins the status marker while the file is being worked on", () => {
    const { container } = setup(text({ stage: "stage.reading", status: "running" }));

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("explains OCR inside the warning that mentions it", async () => {
    setup(
      pdf({
        result: { blob: new Blob(["hi"]), redactionCount: 1, warnings: ["warning.scannedPages"] },
        status: "done",
      }),
    );

    fireEvent.click(screen.getByLabelText("Details for card.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "OCR" }));

    expect(await screen.findByText(/optical character recognition/iv)).toBeInTheDocument();
  });

  it("opens a failed row without being asked", () => {
    setup(text({ error: "The worker gave up", status: "error" }));

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("The worker gave up")).toBeInTheDocument();
  });

  it("opens a row that fails long after it mounted", () => {
    const { rerenderWith } = setup(text());

    rerenderWith(text({ error: "The worker gave up", status: "error" }));

    expect(screen.getByText("The worker gave up")).toBeInTheDocument();
  });

  it("respects a reader who shuts a failed row again", () => {
    const { rerenderWith } = setup(text());

    rerenderWith(text({ error: "The worker gave up", status: "error" }));
    fireEvent.click(screen.getByLabelText("Details for notes.txt"));

    expect(screen.queryByText("The worker gave up")).toBeNull();
  });

  it("offers no disclosure on a queued file that reaches OCR", () => {
    setup(pdf());

    expect(screen.queryByLabelText("Details for card.pdf")).toBeNull();
  });

  it("offers no disclosure at all on a clean text file", () => {
    setup(
      text({ result: { blob: new Blob(["hi"]), redactionCount: 1, warnings: [] }, status: "done" }),
    );

    expect(screen.queryByLabelText("Details for notes.txt")).toBeNull();
  });

  it("reports its own selection", () => {
    const { onSelect } = setup(text());

    fireEvent.click(screen.getByLabelText("Select notes.txt"));

    expect(onSelect).toHaveBeenCalledWith("job-1", true);
  });

  it("unpicks a row that was already picked", () => {
    const { onSelect } = setup(text(), true);

    fireEvent.click(screen.getByLabelText("Select notes.txt"));

    expect(onSelect).toHaveBeenCalledWith("job-1", false);
  });
});

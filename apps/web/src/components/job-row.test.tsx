import type { Detection } from "@repo/redact-core";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job, JobState } from "../store";
import { jobOf, renderWithI18n } from "../test-utils";

import { JobRow } from "./job-row";

const PDF = new File(["%PDF"], "card.pdf", { type: "application/pdf" });

const text = (state?: JobState) => jobOf(state);

const pdf = (state?: JobState) => jobOf(state, { file: PDF });

const ANA: Detection = {
  confidence: 0.9,
  end: 8,
  id: "a",
  label: "private_person",
  preview: "Ana Lima",
  start: 0,
};

const setup = (job: Job, { modelLoading = false, selected = false } = {}) => {
  const onApply = vi.fn<(id: string, covered: ReadonlyArray<string>) => void>();
  const onCoveredChange = vi.fn<(id: string, covered: ReadonlyArray<string>) => void>();
  const onRemove = vi.fn<(id: string) => void>();
  const onSelect = vi.fn<(id: string, next: boolean) => void>();

  const view = renderWithI18n(
    <ul>
      <JobRow
        index={0}
        job={job}
        modelLoading={modelLoading}
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
          modelLoading={modelLoading}
          onApply={onApply}
          onCoveredChange={onCoveredChange}
          onRemove={onRemove}
          onSelect={onSelect}
          selected={selected}
        />
      </ul>,
    );
  };

  return { container: view.container, onApply, onRemove, onSelect, rerenderWith };
};

const LOW_CONFIDENCE =
  "Some text was hard to read, so a little personal data may have been missed.";

describe("JobRow", () => {
  it("keeps the warnings behind the disclosure until it is opened", () => {
    setup(
      pdf({
        phase: "done",
        result: { blob: new Blob(["hi"]), redactionCount: 1, warnings: ["warning.lowConfidence"] },
      }),
    );

    expect(screen.queryByText(LOW_CONFIDENCE)).toBeNull();

    fireEvent.click(screen.getByLabelText("Details for card.pdf"));

    expect(screen.getByText(LOW_CONFIDENCE)).toBeInTheDocument();
  });

  it("spins the status marker while the file is being worked on", () => {
    const { container } = setup(text({ phase: "analysing", progress: 0, stage: "stage.reading" }));

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(container.querySelector("[class*=animate-spin]")).toBeInTheDocument();
  });

  it("keeps spinning while the decisions are applied", () => {
    const { container } = setup(text({ phase: "applying", progress: 0.5 }));

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(container.querySelector("[class*=animate-spin]")).toBeInTheDocument();
  });

  it("says a queued file waits on the model while the model loads", () => {
    setup(text(), { modelLoading: true });

    expect(screen.getByText("Loading the detection model")).toBeInTheDocument();
  });

  it("says nothing of the model to a queued file waiting on a loaded one", () => {
    setup(text());

    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.queryByText("Loading the detection model")).toBeNull();
  });

  it("applies the covered set the review shows", () => {
    const { onApply } = setup(
      text({
        analysis: { detections: [ANA], handle: undefined, warnings: [] },
        covered: ["a"],
        phase: "reviewing",
        progress: 0.5,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply redactions" }));

    expect(onApply).toHaveBeenCalledWith("job-1", ["a"]);
  });

  it("explains OCR inside the warning that mentions it", async () => {
    setup(
      pdf({
        phase: "done",
        result: { blob: new Blob(["hi"]), redactionCount: 1, warnings: ["warning.scannedPages"] },
      }),
    );

    fireEvent.click(screen.getByLabelText("Details for card.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "OCR" }));

    expect(await screen.findByText(/optical character recognition/iv)).toBeInTheDocument();
  });

  it("opens a failed row without being asked", () => {
    setup(text({ error: "The worker gave up", phase: "error" }));

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("The worker gave up")).toBeInTheDocument();
  });

  it("opens a row that fails long after it mounted", () => {
    const { rerenderWith } = setup(text());

    rerenderWith(text({ error: "The worker gave up", phase: "error" }));

    expect(screen.getByText("The worker gave up")).toBeInTheDocument();
  });

  it("respects a reader who shuts a failed row again", () => {
    const { rerenderWith } = setup(text());

    rerenderWith(text({ error: "The worker gave up", phase: "error" }));
    fireEvent.click(screen.getByLabelText("Details for notes.txt"));

    expect(screen.queryByText("The worker gave up")).toBeNull();
  });

  it("offers no disclosure on a queued file that reaches OCR", () => {
    setup(pdf());

    expect(screen.queryByLabelText("Details for card.pdf")).toBeNull();
  });

  it("offers no disclosure at all on a clean text file", () => {
    setup(
      text({ phase: "done", result: { blob: new Blob(["hi"]), redactionCount: 1, warnings: [] } }),
    );

    expect(screen.queryByLabelText("Details for notes.txt")).toBeNull();
  });

  it("reports its own selection", () => {
    const { onSelect } = setup(text());

    fireEvent.click(screen.getByLabelText("Select notes.txt"));

    expect(onSelect).toHaveBeenCalledWith("job-1", true);
  });

  it("unpicks a row that was already picked", () => {
    const { onSelect } = setup(text(), { selected: true });

    fireEvent.click(screen.getByLabelText("Select notes.txt"));

    expect(onSelect).toHaveBeenCalledWith("job-1", false);
  });
});

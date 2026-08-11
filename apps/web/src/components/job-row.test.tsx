import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../store";
import { renderWithI18n } from "../test-utils";

import { JobRow } from "./job-row";

const text = (patch: Partial<Job> = {}): Job => ({
  dismissed: [],
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  kept: [],
  progress: 0,
  status: "queued",
  ...patch,
});

const pdf = (patch: Partial<Job> = {}): Job =>
  text({ file: new File(["%PDF"], "card.pdf", { type: "application/pdf" }), ...patch });

const setup = (job: Job, selected = false) => {
  const onApply = vi.fn<(id: string) => void>();
  const onDismissedChange = vi.fn<(id: string, dismissed: ReadonlyArray<string>) => void>();
  const onKeptChange = vi.fn<(id: string, kept: ReadonlyArray<string>) => void>();
  const onLanguageChange = vi.fn<(id: string, choice: "auto" | "en" | "es" | "pt") => void>();
  const onRemove = vi.fn<(id: string) => void>();
  const onSelect = vi.fn<(id: string, next: boolean) => void>();

  const view = renderWithI18n(
    <ul>
      <JobRow
        index={0}
        job={job}
        onApply={onApply}
        onDismissedChange={onDismissedChange}
        onKeptChange={onKeptChange}
        onLanguageChange={onLanguageChange}
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
          onDismissedChange={onDismissedChange}
          onKeptChange={onKeptChange}
          onLanguageChange={onLanguageChange}
          onRemove={onRemove}
          onSelect={onSelect}
          selected={selected}
        />
      </ul>,
    );
  };

  return { container: view.container, onLanguageChange, onRemove, onSelect, rerenderWith };
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

  it("offers a language on a file that reaches OCR", () => {
    setup(pdf());

    fireEvent.click(screen.getByLabelText("Details for card.pdf"));

    expect(screen.getByRole("combobox", { name: "Document language" })).toBeInTheDocument();
  });

  it("offers no disclosure at all on a clean text file", () => {
    setup(
      text({ result: { blob: new Blob(["hi"]), redactionCount: 1, warnings: [] }, status: "done" }),
    );

    expect(screen.queryByLabelText("Details for notes.txt")).toBeNull();
  });

  it("shows the language a file was given", () => {
    setup(pdf({ language: "pt" }));

    fireEvent.click(screen.getByLabelText("Details for card.pdf"));

    expect(screen.getByRole("combobox", { name: "Document language" })).toHaveTextContent(
      "Português",
    );
  });

  it("reports a language change with the row's own id", async () => {
    const { onLanguageChange } = setup(pdf({ id: "job-pdf" }));

    fireEvent.click(screen.getByLabelText("Details for card.pdf"));
    fireEvent.click(screen.getByRole("combobox", { name: "Document language" }));

    const option = await screen.findByRole("option", { name: "Español" });

    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);

    expect(onLanguageChange).toHaveBeenCalledWith("job-pdf", "es");
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

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../store";
import { renderWithI18n } from "../test-utils";

import { JobRow } from "./job-row";

const text = (patch: Partial<Job> = {}): Job => ({
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  progress: 0,
  run: 0,
  status: "queued",
  ...patch,
});

const pdf = (patch: Partial<Job> = {}): Job =>
  text({ file: new File(["%PDF"], "card.pdf", { type: "application/pdf" }), ...patch });

const setup = (job: Job, selected = false) => {
  const onLanguageChange = vi.fn<(id: string, choice: "auto" | "en" | "es" | "pt") => void>();
  const onRemove = vi.fn<(id: string) => void>();
  const onSelect = vi.fn<(id: string, next: boolean) => void>();

  const view = renderWithI18n(
    <ul>
      <JobRow
        index={0}
        job={job}
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
  // jsdom lays out nothing, so this reads the rule rather than the pixels: the panel is
  // a flex child whose height animates up from zero, and a gap on its parent would be
  // reserved in full the moment it mounts, stepping the rows below down before the
  // panel had opened at all.
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

  // The reason a file failed is the point of the row, so it is never one click away.
  it("opens a failed row without being asked", () => {
    setup(text({ error: "The worker gave up", status: "error" }));

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("The worker gave up")).toBeInTheDocument();
  });

  // Every row mounts queued and fails later, if at all, so a default read once at mount
  // would leave every real failure shut.
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

  // Language only reaches the recogniser, and the text redactor ignores it, so offering
  // it on a .txt would be offering a control that does nothing.
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

import type { Detection } from "@repo/redact-core";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "../test-utils";

import { DetectionReview } from "./detection-review";

const detection = (patch: Partial<Detection> = {}): Detection => ({
  confidence: 0.9,
  end: 8,
  id: "a",
  label: "private_person",
  preview: "Ana Lima",
  start: 0,
  ...patch,
});

// Review opens with everything certain already covered, which is what the app seeds it with.
const setup = (detections: Array<Detection>, covered?: ReadonlyArray<string>) => {
  const onApply = vi.fn<() => void>();
  const onCoveredChange = vi.fn<(next: ReadonlyArray<string>) => void>();

  renderWithI18n(
    <DetectionReview
      covered={
        covered ?? detections.filter((entry) => entry.confidence >= 0.65).map((entry) => entry.id)
      }
      detections={detections}
      onApply={onApply}
      onCoveredChange={onCoveredChange}
    />,
  );

  return { onApply, onCoveredChange };
};

describe("DetectionReview", () => {
  it("lists a row per detection with its preview and confidence", () => {
    setup([detection(), detection({ id: "b", preview: "Joao Reis" })]);

    expect(screen.getByText("Ana Lima")).toBeInTheDocument();
    expect(screen.getByText("Joao Reis")).toBeInTheDocument();
    expect(screen.getAllByText(/90%/v)).toHaveLength(2);
  });

  it("groups by label and names the group", () => {
    setup([detection(), detection({ id: "b", label: "secret", preview: "hunter2" })]);

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Secret")).toBeInTheDocument();
  });

  it("checks a detection that will be covered and unchecks a dismissed one", () => {
    setup([detection(), detection({ id: "b", preview: "Joao Reis" })], ["a"]);

    const boxes = screen.getAllByRole("checkbox");

    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
  });

  it("dismisses a detection when its box is unchecked", () => {
    const { onCoveredChange } = setup([detection()]);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onCoveredChange).toHaveBeenCalledWith([]);
  });

  it("brings a dismissed detection back when its box is checked again", () => {
    const { onCoveredChange } = setup([detection()], []);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onCoveredChange).toHaveBeenCalledWith(["a"]);
  });

  it("dismisses a whole group without touching the others", () => {
    const { onCoveredChange } = setup([
      detection(),
      detection({ id: "b", preview: "Joao Reis" }),
      detection({ id: "c", label: "secret", preview: "hunter2" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Keep all Name readable/v }));

    expect(onCoveredChange).toHaveBeenCalledWith(["c"]);
  });

  it("counts what is still going to be covered", () => {
    setup([detection(), detection({ id: "b", preview: "Joao Reis" })], ["a"]);

    expect(screen.getByText("1 of 2 will be covered")).toBeInTheDocument();
  });

  it("announces that count politely", () => {
    setup([detection()]);

    expect(screen.getByText("1 of 1 will be covered")).toHaveAttribute("aria-live", "polite");
  });

  it("applies when the apply button is pressed", () => {
    const { onApply } = setup([detection()]);

    fireEvent.click(screen.getByRole("button", { name: "Apply redactions" }));

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("covers every certain detection again when told to cover everything", () => {
    const { onApply, onCoveredChange } = setup([detection()], []);

    fireEvent.click(screen.getByRole("button", { name: "Cover everything" }));

    expect(onCoveredChange).toHaveBeenCalledWith(["a"]);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("names a page when the detection carries one", () => {
    setup([detection({ page: 2 })]);

    expect(screen.getByText(/Page 3/v)).toBeInTheDocument();
  });

  it("offers to move on when there is nothing to review", () => {
    setup([]);

    expect(screen.getByText("Nothing was found in this file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply redactions" })).toBeInTheDocument();
  });

  it("keeps suggestions out of the main list and behind a summary", () => {
    setup([detection(), detection({ confidence: 0.2, id: "b", preview: "Maybe Name" })]);

    expect(screen.getByText("1 more the model was unsure about")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 will be covered")).toBeInTheDocument();
  });

  it("leaves a suggestion unchecked until it is ticked", () => {
    const { onCoveredChange } = setup([
      detection({ confidence: 0.2, id: "b", preview: "Maybe Name" }),
    ]);

    const box = screen.getByRole("checkbox", { name: "Cover Maybe Name" });

    expect(box).not.toBeChecked();

    fireEvent.click(box);

    expect(onCoveredChange).toHaveBeenCalledWith(["b"]);
  });

  it("counts a ticked suggestion towards what will be covered", () => {
    setup(
      [detection(), detection({ confidence: 0.2, id: "b", preview: "Maybe Name" })],
      ["a", "b"],
    );

    expect(screen.getByText("2 of 2 will be covered")).toBeInTheDocument();
  });

  it("labels each box with what it covers, for a screen reader", () => {
    setup([detection()]);

    expect(screen.getByRole("checkbox", { name: "Cover Ana Lima" })).toBeInTheDocument();
  });
});

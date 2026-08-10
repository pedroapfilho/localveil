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
  source: "model",
  start: 0,
  ...patch,
});

const setup = (detections: Array<Detection>, dismissed: ReadonlyArray<string> = []) => {
  const onApply = vi.fn<() => void>();
  const onDismissedChange = vi.fn<(next: ReadonlyArray<string>) => void>();

  renderWithI18n(
    <DetectionReview
      detections={detections}
      dismissed={dismissed}
      onApply={onApply}
      onDismissedChange={onDismissedChange}
    />,
  );

  return { onApply, onDismissedChange };
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
    setup([detection(), detection({ id: "b", preview: "Joao Reis" })], ["b"]);

    const boxes = screen.getAllByRole("checkbox");

    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
  });

  it("dismisses a detection when its box is unchecked", () => {
    const { onDismissedChange } = setup([detection()]);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onDismissedChange).toHaveBeenCalledWith(["a"]);
  });

  it("brings a dismissed detection back when its box is checked again", () => {
    const { onDismissedChange } = setup([detection()], ["a"]);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onDismissedChange).toHaveBeenCalledWith([]);
  });

  it("dismisses a whole group without touching the others", () => {
    const { onDismissedChange } = setup([
      detection(),
      detection({ id: "b", preview: "Joao Reis" }),
      detection({ id: "c", label: "secret", preview: "hunter2" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Keep all Name readable/v }));

    expect(onDismissedChange).toHaveBeenCalledWith(["a", "b"]);
  });

  it("counts what is still going to be covered", () => {
    setup([detection(), detection({ id: "b", preview: "Joao Reis" })], ["b"]);

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

  it("clears every dismissal when told to cover everything", () => {
    const { onApply, onDismissedChange } = setup([detection()], ["a"]);

    fireEvent.click(screen.getByRole("button", { name: "Cover everything" }));

    expect(onDismissedChange).toHaveBeenCalledWith([]);
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

  it("labels each box with what it covers, for a screen reader", () => {
    setup([detection()]);

    expect(screen.getByRole("checkbox", { name: "Cover Ana Lima" })).toBeInTheDocument();
  });
});

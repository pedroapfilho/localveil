import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithI18n } from "../test-utils";

import { GlossaryText } from "./glossary-text";

describe("GlossaryText", () => {
  it("preserves repeated term controls when surrounding text changes", () => {
    const { container, rerender } = renderWithI18n(<GlossaryText>OCR then OCR</GlossaryText>);
    const original = screen.getAllByRole("button", { name: "OCR" });

    rerender(<GlossaryText>First searchable text, then OCR and OCR</GlossaryText>);

    const updated = screen.getAllByRole("button", { name: "OCR" });
    expect(updated[0]).toBe(original[0]);
    expect(updated[1]).toBe(original[1]);
    expect(container).toHaveTextContent("First searchable text, then OCR and OCR");
  });

  it("keeps ordinary text unchanged", () => {
    renderWithI18n(<GlossaryText>No terms in this sentence.</GlossaryText>);

    expect(screen.getByText("No terms in this sentence.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

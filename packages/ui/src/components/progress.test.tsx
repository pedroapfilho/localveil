import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "./progress";

const renderProgress = (value: number) => {
  render(<Progress label="Downloading model" value={value} />);

  return screen.getByRole("progressbar", { name: "Downloading model" });
};

const percentOf = (bar: HTMLElement) => Number(bar.getAttribute("aria-valuenow"));

const fillOf = (bar: HTMLElement) => {
  const fill = bar.querySelector("[data-slot=progress-indicator]");

  if (!(fill instanceof HTMLElement)) {
    throw new TypeError("Progress rendered no fill to measure");
  }

  return fill.style.transform;
};

describe("Progress", () => {
  it("reports the fraction as a percentage of 100", () => {
    const bar = renderProgress(0.42);

    expect(percentOf(bar)).toBe(42);
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("clamps a value above the range", () => {
    expect(percentOf(renderProgress(4))).toBe(100);
  });

  it("clamps a value below the range", () => {
    expect(percentOf(renderProgress(-1))).toBe(0);
  });

  it("treats a non-finite value as no progress", () => {
    expect(percentOf(renderProgress(Number.NaN))).toBe(0);
  });

  it("draws the fill with a transform", () => {
    expect(fillOf(renderProgress(0.42))).toBe("scaleX(0.42)");
  });

  it("draws nothing at all at zero", () => {
    expect(fillOf(renderProgress(0))).toBe("scaleX(0)");
  });
});

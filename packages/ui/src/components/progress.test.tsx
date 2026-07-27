import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "./progress";

const renderProgress = (value: number) => {
  render(<Progress label="Downloading model" value={value} />);

  const bar = screen.getByLabelText("Downloading model");

  if (!(bar instanceof HTMLProgressElement)) {
    throw new TypeError("Progress did not render a progress element");
  }

  return bar;
};

describe("Progress", () => {
  it("reports the fraction as a percentage of 100", () => {
    const bar = renderProgress(0.42);

    expect(bar.value).toBe(42);
    expect(bar.max).toBe(100);
  });

  it("clamps a value above the range", () => {
    expect(renderProgress(4).value).toBe(100);
  });

  it("clamps a value below the range", () => {
    expect(renderProgress(-1).value).toBe(0);
  });

  it("treats a non-finite value as no progress", () => {
    expect(renderProgress(Number.NaN).value).toBe(0);
  });
});

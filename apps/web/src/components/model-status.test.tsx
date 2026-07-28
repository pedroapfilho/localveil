import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithI18n } from "../test-utils";
import type { ModelState } from "../use-redaction";

import { ModelStatus } from "./model-status";

const model = (patch: Partial<ModelState> = {}): ModelState => ({
  fraction: 0,
  slowDevice: false,
  ...patch,
});

const SLOW = "Running without GPU acceleration, this will be slow.";

describe("ModelStatus", () => {
  it("renders nothing before the model reports anything", () => {
    const { container } = renderWithI18n(<ModelStatus model={model()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once the model is ready", () => {
    const { container } = renderWithI18n(
      <ModelStatus model={model({ fraction: 1, stage: "model.ready" })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the model loads from storage", () => {
    const { container } = renderWithI18n(
      <ModelStatus model={model({ stage: "model.slowDevice" })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the download percentage as text and on a progress bar", () => {
    renderWithI18n(<ModelStatus model={model({ fraction: 0.42, stage: "model.downloading" })} />);

    const bar = screen.getByRole("progressbar", { name: "Downloading the detection model" });

    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByText("Downloading the detection model")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  // The percentage is read in the reader's own locale, not with a hardcoded point.
  it("formats the percentage for the locale in use", () => {
    renderWithI18n(<ModelStatus model={model({ fraction: 0.07, stage: "model.downloading" })} />);

    expect(screen.getByText("7%")).toBeInTheDocument();
  });

  it("warns about a slow device while the model downloads", () => {
    renderWithI18n(<ModelStatus model={model({ slowDevice: true, stage: "model.downloading" })} />);

    expect(screen.getByText(SLOW)).toBeInTheDocument();
  });

  it("keeps the slow device warning after the model is ready", () => {
    renderWithI18n(
      <ModelStatus model={model({ fraction: 1, slowDevice: true, stage: "model.ready" })} />,
    );

    expect(screen.getByText(SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("says the device is slow only once", () => {
    renderWithI18n(<ModelStatus model={model({ slowDevice: true, stage: "model.slowDevice" })} />);

    expect(screen.getAllByText(SLOW).length).toBe(1);
  });
});

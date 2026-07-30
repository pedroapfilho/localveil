import { screen } from "@testing-library/react";
import type * as Motion from "motion/react";
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../store";
import { renderWithI18n } from "../test-utils";
import type { ModelState } from "../use-redaction";

import { StatusPanel } from "./status-panel";

// The hook rather than `matchMedia`: Motion reads the query once when its module loads,
// so a global stubbed from inside a test arrives too late to be seen.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof Motion>()),
  useReducedMotion: () => true,
}));

const SLOW = "Running without GPU acceleration, this will be slow.";

const job = (): Job => ({
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  progress: 0,
  run: 0,
  status: "queued",
});

const model: ModelState = { fraction: 0.5, slowDevice: true, stage: "model.downloading" };

const lineFor = (text: string) => screen.getByText(text).parentElement;

// Asking for less motion is not asking for none: the line still fades, it just stops
// travelling. Zeroing the duration would take the fade with it.
describe("StatusPanel under prefers-reduced-motion", () => {
  // Arriving on a rerender rather than at first render, because the panel's
  // AnimatePresence is `initial={false}` and skips the entrance of anything already
  // there when it mounts.
  //
  // This guards the fade being dropped from the reduced branch, not the duration being
  // zeroed: jsdom runs no frames, so the opening value is there either way. Zero
  // durations are kept out structurally instead, by there being no reduced-motion
  // transition to set one on.
  it("still gives the slow device line an opacity to fade from", () => {
    const view = renderWithI18n(
      <StatusPanel jobs={[job()]} model={{ ...model, slowDevice: false }} />,
    );

    view.rerender(<StatusPanel jobs={[job()]} model={model} />);

    expect(lineFor(SLOW)).toHaveStyle({ opacity: "0" });
  });

  it("leaves the height alone, which is the part that travels", () => {
    renderWithI18n(<StatusPanel jobs={[job()]} model={model} />);

    expect(lineFor(SLOW)?.style.height).toBe("");
  });
});

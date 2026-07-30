import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Job } from "../store";
import type { ModelState } from "../use-redaction";

import { useOverallProgress } from "./use-overall-progress";

type Props = { jobs: Array<Job>; model: ModelState };

const model = (patch: Partial<ModelState> = {}): ModelState => ({
  fraction: 0,
  slowDevice: false,
  ...patch,
});

const job = (patch: Partial<Job> = {}): Job => ({
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  progress: 0,
  run: 0,
  status: "queued",
  ...patch,
});

const setup = (initialProps: Props) =>
  renderHook(({ jobs, model: state }: Props) => useOverallProgress(jobs, state), {
    initialProps,
  });

describe("useOverallProgress", () => {
  it("rests at empty with nothing queued", () => {
    const { result } = setup({ jobs: [], model: model() });

    expect(result.current).toBe(0);
  });

  // The whole point: the model download and the files behind it share one bar, so it
  // fills once instead of running to full and starting over.
  it("never goes backwards across a download and the file that waited on it", () => {
    const downloading = (fraction: number) => model({ fraction, stage: "model.downloading" });
    const { rerender, result } = setup({ jobs: [job()], model: downloading(0) });

    const seen: Array<number> = [result.current];

    const step = (props: Props) => {
      rerender(props);
      seen.push(result.current);
    };

    step({ jobs: [job()], model: downloading(0.5) });
    step({ jobs: [job()], model: downloading(1) });
    step({ jobs: [job()], model: model({ fraction: 1, stage: "model.ready" }) });
    step({
      jobs: [job({ progress: 0.5, status: "running" })],
      model: model({ fraction: 1, stage: "model.ready" }),
    });
    step({
      jobs: [job({ progress: 1, status: "done" })],
      model: model({ fraction: 1, stage: "model.ready" }),
    });

    expect(seen).toEqual([...seen].toSorted((left, right) => left - right));
    expect(seen.at(0)).toBe(0);
    expect(seen.at(-1)).toBe(1);
  });

  it("gives the model a share of the bar alongside each file", () => {
    const { result } = setup({
      jobs: [job(), job({ id: "job-2" })],
      model: model({ fraction: 1, stage: "model.downloading" }),
    });

    expect(result.current).toBeCloseTo(1 / 3);
  });

  // A batch dropped once the model is ready has not been waiting on anything, and
  // crediting it for a download that already happened would open the bar half full.
  it("leaves the model out for a batch that never waited for it", () => {
    const ready = model({ fraction: 1, stage: "model.ready" });
    const { rerender, result } = setup({ jobs: [], model: ready });

    rerender({ jobs: [job()], model: ready });

    expect(result.current).toBe(0);
  });

  it("counts only the files once the model was already there", () => {
    const ready = model({ fraction: 1, stage: "model.ready" });
    const { rerender, result } = setup({ jobs: [], model: ready });

    rerender({ jobs: [job({ progress: 0.5, status: "running" })], model: ready });

    expect(result.current).toBe(0.5);
  });

  it("keeps the model counted for the batch that started before it was ready", () => {
    const { rerender, result } = setup({ jobs: [], model: model() });

    rerender({ jobs: [job()], model: model({ fraction: 0, stage: "model.downloading" }) });
    rerender({ jobs: [job()], model: model({ fraction: 1, stage: "model.ready" }) });

    expect(result.current).toBe(0.5);
  });

  it("reaches full only when every file has finished", () => {
    const ready = model({ fraction: 1, stage: "model.ready" });
    const { rerender, result } = setup({ jobs: [], model: ready });

    rerender({
      jobs: [job({ progress: 1, status: "done" }), job({ id: "job-2", progress: 0.5 })],
      model: ready,
    });

    expect(result.current).toBe(0.75);
  });
});

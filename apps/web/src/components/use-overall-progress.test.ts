import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Job } from "../store";
import type { ModelState } from "../use-redaction";

import { useOverallProgress } from "./use-overall-progress";

type Props = { jobs: Array<Job>; model: ModelState };

const model = (patch: Partial<ModelState> = {}): ModelState => ({
  fraction: 0,
  ...patch,
});

const job = (patch: Partial<Job> = {}): Job => ({
  file: new File(["hello"], "notes.txt", { type: "text/plain" }),
  id: "job-1",
  progress: 0,
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

// A file that fails stops reporting wherever it got to. Leaving that last fraction in
// the sum held the bar short of full for a queue that had entirely finished.
describe("a file that failed", () => {
  const ready = model({ fraction: 1, stage: "model.ready" });

  const failed = (patch: Partial<Job> = {}) =>
    job({ error: "boom", progress: 0.4, status: "error", ...patch });

  it("counts for its whole share rather than for where it stopped", () => {
    const { rerender, result } = setup({ jobs: [], model: ready });

    rerender({ jobs: [failed()], model: ready });

    expect(result.current).toBe(1);
  });

  it("lets a queue that failed outright still read as finished", () => {
    const { rerender, result } = setup({ jobs: [], model: ready });

    rerender({ jobs: [failed(), failed({ id: "job-2", progress: 0 })], model: ready });

    expect(result.current).toBe(1);
  });

  it("fills alongside the files that succeeded", () => {
    const { rerender, result } = setup({ jobs: [], model: ready });

    rerender({
      jobs: [failed(), job({ id: "job-2", progress: 1, status: "done" })],
      model: ready,
    });

    expect(result.current).toBe(1);
  });

  it("still leaves room for a file that is only part way through", () => {
    const { rerender, result } = setup({ jobs: [], model: ready });

    rerender({
      jobs: [failed(), job({ id: "job-2", progress: 0.5, status: "running" })],
      model: ready,
    });

    expect(result.current).toBe(0.75);
  });

  // A file the worker cannot read fails before the model is ever asked for, so the
  // model's own share of the bar would otherwise never be filled in.
  it("fills even when the batch failed before the model was needed", () => {
    const { rerender, result } = setup({ jobs: [], model: model() });

    rerender({ jobs: [failed({ progress: 0 })], model: model() });

    expect(result.current).toBe(1);
  });

  // The crash path fails whichever file was running and hands the rest to a new worker,
  // so a failure lands mid-batch with work still queued behind it.
  it("never sends the bar backwards when a file fails mid-batch", () => {
    const { rerender, result } = setup({ jobs: [], model: ready });

    const seen: Array<number> = [];

    const step = (jobs: Array<Job>) => {
      rerender({ jobs, model: ready });
      seen.push(result.current);
    };

    step([job({ progress: 0.4, status: "running" }), job({ id: "job-2" })]);
    step([failed(), job({ id: "job-2", progress: 0.5, status: "running" })]);
    step([failed(), job({ id: "job-2", progress: 1, status: "done" })]);

    expect(seen).toEqual([...seen].toSorted((left, right) => left - right));
    expect(seen.at(-1)).toBe(1);
  });
});

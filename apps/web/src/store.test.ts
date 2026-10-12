import { assert, beforeEach, describe, expect, it } from "vitest";

import type { JobState } from "./store";
import {
  completedJobs,
  failedJobs,
  hasCompletedJobs,
  holdsModel,
  progressOf,
  stageOf,
  useJobStore,
} from "./store";
import { jobOf } from "./test-utils";

const textFile = (name: string) => new File(["hello"], name, { type: "text/plain" });

const doneResult = { blob: new Blob(["hello"]), redactionCount: 1, warnings: [] };

const jobsOf = () => useJobStore.getState().jobs;

const found = (id: string) => useJobStore.getState().jobs.find((entry) => entry.id === id);

const withState = (state: JobState, id = "id") => jobOf(state, { id });

const analysing: JobState = { phase: "analysing", progress: 0.2, stage: "stage.reading" };

const reviewing: JobState = {
  analysis: { detections: [], handle: undefined, warnings: [] },
  covered: [],
  phase: "reviewing",
  progress: 0.5,
};

describe("useJobStore review state", () => {
  beforeEach(() => {
    useJobStore.getState().reset();
  });

  it("starts a job queued, with no analysis to speak of", () => {
    const [job] = useJobStore.getState().addFiles([new File(["x"], "a.txt")]);

    assert.isDefined(job);

    expect(job.phase).toBe("queued");
    expect(progressOf(job)).toBe(0);
  });

  it("holds an analysis and the covered ids while a job waits for review", () => {
    const [job] = useJobStore.getState().addFiles([new File(["x"], "a.txt")]);

    assert.isDefined(job);

    const analysis = { detections: [], handle: undefined, warnings: [] };

    useJobStore
      .getState()
      .setState(job.id, { analysis, covered: ["a"], phase: "reviewing", progress: 0.5 });

    const updated = found(job.id);

    expect(updated?.phase).toBe("reviewing");
    expect(updated?.phase === "reviewing" ? updated.covered : undefined).toEqual(["a"]);
  });

  it("changes the covered ids only while the job is under review", () => {
    const [job] = useJobStore.getState().addFiles([new File(["x"], "a.txt")]);

    assert.isDefined(job);

    useJobStore.getState().setCovered(job.id, ["a"]);
    expect(found(job.id)?.phase).toBe("queued");

    useJobStore.getState().setState(job.id, {
      analysis: { detections: [], handle: undefined, warnings: [] },
      covered: [],
      phase: "reviewing",
      progress: 0.5,
    });
    useJobStore.getState().setCovered(job.id, ["a"]);

    const updated = found(job.id);

    expect(updated?.phase === "reviewing" ? updated.covered : undefined).toEqual(["a"]);
  });

  it("forgets the analysis and the decisions when a job moves on", () => {
    const [job] = useJobStore.getState().addFiles([new File(["x"], "a.txt")]);

    assert.isDefined(job);

    useJobStore.getState().setState(job.id, {
      analysis: { detections: [], handle: undefined, warnings: [] },
      covered: ["a"],
      phase: "reviewing",
      progress: 0.5,
    });
    useJobStore.getState().setState(job.id, { phase: "applying", progress: 0.5 });

    const applying = found(job.id);

    expect(applying?.phase).toBe("applying");
    expect(Object.keys(applying ?? {}).toSorted()).toEqual([
      "file",
      "id",
      "path",
      "phase",
      "progress",
    ]);
  });
});

describe("useJobStore", () => {
  beforeEach(() => {
    useJobStore.getState().reset();
  });

  it("queues one job per added file", () => {
    useJobStore.getState().addFiles([textFile("a.txt"), textFile("b.txt")]);

    expect(jobsOf().map((job) => job.file.name)).toEqual(["a.txt", "b.txt"]);
    expect(jobsOf().every((job) => job.phase === "queued" && progressOf(job) === 0)).toBe(true);
  });

  it("names a loose file by its own name", () => {
    useJobStore.getState().addFiles([textFile("a.txt")]);

    expect(jobsOf()[0]?.path).toBe("a.txt");
  });

  it("retains a selected folder path for the list and output archive", () => {
    const file = textFile("report.txt");

    useJobStore.getState().addFiles([{ file, path: "cases/august/report.txt" }]);

    expect(jobsOf()[0]).toMatchObject({ file, path: "cases/august/report.txt" });
  });

  it("gives every job its own id", () => {
    const created = useJobStore.getState().addFiles([textFile("a.txt"), textFile("a.txt")]);

    expect(new Set(created.map((job) => job.id)).size).toBe(2);
  });

  it("keeps earlier jobs when more files arrive", () => {
    useJobStore.getState().addFiles([textFile("a.txt")]);
    useJobStore.getState().addFiles([textFile("b.txt")]);

    expect(jobsOf().length).toBe(2);
  });

  it("moves only the job it was given", () => {
    const [first, second] = useJobStore.getState().addFiles([textFile("a.txt"), textFile("b.txt")]);

    assert.isDefined(first);
    assert.isDefined(second);

    useJobStore
      .getState()
      .setState(first.id, { phase: "analysing", progress: 0.2, stage: "stage.reading" });

    expect(found(first.id)?.phase).toBe("analysing");
    expect(found(second.id)?.phase).toBe("queued");
  });

  it("ignores a transition for an id it does not know", () => {
    useJobStore.getState().addFiles([textFile("a.txt")]);

    useJobStore.getState().setState("missing", { phase: "done", result: doneResult });

    expect(jobsOf().map((job) => job.phase)).toEqual(["queued"]);
  });

  it("clears everything on reset", () => {
    useJobStore.getState().addFiles([textFile("a.txt")]);

    useJobStore.getState().reset();

    expect(jobsOf()).toEqual([]);
  });

  it("removes several jobs at once and leaves the rest", () => {
    const [first, second, third] = useJobStore
      .getState()
      .addFiles([textFile("a.txt"), textFile("b.txt"), textFile("c.txt")]);

    assert.isDefined(first);
    assert.isDefined(second);
    assert.isDefined(third);

    useJobStore.getState().removeJobs([first.id, third.id]);

    expect(jobsOf().map((job) => job.id)).toEqual([second.id]);
  });

  it("ignores ids it does not know when removing in bulk", () => {
    useJobStore.getState().addFiles([textFile("a.txt")]);

    useJobStore.getState().removeJobs(["missing"]);

    expect(jobsOf().length).toBe(1);
  });
});

describe("job selectors", () => {
  it("reports nothing completed while a job is still queued", () => {
    const jobs = [
      withState({ phase: "done", result: doneResult }, "1"),
      withState({ phase: "queued" }, "2"),
    ];

    expect(hasCompletedJobs(jobs)).toBe(false);
  });

  it("reports nothing completed while a job is still being worked on", () => {
    const jobs = [withState({ phase: "done", result: doneResult }, "1"), withState(analysing, "2")];

    expect(hasCompletedJobs(jobs)).toBe(false);
  });

  it("reports nothing completed when every job failed", () => {
    expect(hasCompletedJobs([withState({ error: "boom", phase: "error" })])).toBe(false);
  });

  it("reports nothing completed with no jobs at all", () => {
    expect(hasCompletedJobs([])).toBe(false);
  });

  it("reports completed once every job settled and one succeeded", () => {
    const jobs = [
      withState({ phase: "done", result: doneResult }, "1"),
      withState({ error: "boom", phase: "error" }, "2"),
    ];

    expect(hasCompletedJobs(jobs)).toBe(true);
  });

  it("leaves failed jobs out of the completed set", () => {
    const jobs = [
      withState({ phase: "done", result: doneResult }, "1"),
      withState({ error: "boom", phase: "error" }, "2"),
    ];

    expect(completedJobs(jobs).map((entry) => entry.id)).toEqual(["1"]);
    expect(failedJobs(jobs).map((entry) => entry.id)).toEqual(["2"]);
  });

  it("reads progress off whichever phase carries it", () => {
    expect(progressOf(withState({ phase: "queued" }))).toBe(0);
    expect(progressOf(withState(analysing))).toBe(0.2);
    expect(progressOf(withState(reviewing))).toBe(0.5);
    expect(progressOf(withState({ phase: "done", result: doneResult }))).toBe(1);
    expect(progressOf(withState({ error: "boom", phase: "error" }))).toBe(0);
  });

  it("names the stage a worker reported, and the model load only while it loads", () => {
    expect(stageOf(withState(analysing), true)).toBe("stage.reading");
    expect(stageOf(withState({ phase: "queued" }), true)).toBe("stage.loadingModel");
    expect(stageOf(withState({ phase: "queued" }), false)).toBeUndefined();
    expect(stageOf(withState({ error: "boom", phase: "error" }), true)).toBeUndefined();
  });

  it("holds the model while a file is still reaching it, not while it is in review", () => {
    expect(holdsModel([withState({ phase: "queued" })])).toBe(true);
    expect(holdsModel([withState(analysing)])).toBe(true);
    expect(holdsModel([withState({ phase: "applying", progress: 0.5 })])).toBe(true);
    expect(
      holdsModel([withState(reviewing), withState({ phase: "done", result: doneResult })]),
    ).toBe(false);
  });
});

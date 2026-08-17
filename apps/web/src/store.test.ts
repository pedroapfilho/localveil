import { beforeEach, describe, expect, it } from "vitest";

import type { Job, JobSource, JobState } from "./store";
import {
  completedJobs,
  failedJobs,
  hasCompletedJobs,
  progressOf,
  stageOf,
  useJobStore,
} from "./store";

const textFile = (name: string) => new File(["hello"], name, { type: "text/plain" });

const doneResult = { blob: new Blob(["hello"]), redactionCount: 1, warnings: [] };

const jobsOf = () => useJobStore.getState().jobs;

const found = (id: string) => useJobStore.getState().jobs.find((entry) => entry.id === id);

describe("useJobStore review state", () => {
  beforeEach(() => {
    useJobStore.getState().reset();
  });

  it("starts a job queued, with no analysis to speak of", () => {
    const [job] = useJobStore.getState().addFiles([new File(["x"], "a.txt")]);

    expect(job.status).toBe("queued");
    expect(progressOf(job)).toBe(0);
  });

  it("holds an analysis and the covered ids while a job waits for review", () => {
    const [job] = useJobStore.getState().addFiles([new File(["x"], "a.txt")]);
    const analysis = { detections: [], handle: undefined, warnings: [] };

    useJobStore
      .getState()
      .setState(job.id, { analysis, covered: ["a"], progress: 0.5, status: "reviewing" });

    const updated = found(job.id);

    expect(updated?.status).toBe("reviewing");
    expect(updated?.status === "reviewing" ? updated.covered : undefined).toEqual(["a"]);
  });

  it("changes the covered ids only while the job is under review", () => {
    const [job] = useJobStore.getState().addFiles([new File(["x"], "a.txt")]);

    useJobStore.getState().setCovered(job.id, ["a"]);
    expect(found(job.id)?.status).toBe("queued");

    useJobStore.getState().setState(job.id, {
      analysis: { detections: [], handle: undefined, warnings: [] },
      covered: [],
      progress: 0.5,
      status: "reviewing",
    });
    useJobStore.getState().setCovered(job.id, ["a"]);

    const updated = found(job.id);

    expect(updated?.status === "reviewing" ? updated.covered : undefined).toEqual(["a"]);
  });

  it("forgets the analysis and the decisions when a job is requeued", () => {
    const [job] = useJobStore.getState().addFiles([new File(["x"], "a.txt")]);

    useJobStore.getState().setState(job.id, {
      analysis: { detections: [], handle: undefined, warnings: [] },
      covered: ["a"],
      progress: 0.5,
      status: "reviewing",
    });

    const [requeued] = useJobStore.getState().requeue([job.id]);

    expect(requeued.status).toBe("queued");
    expect(Object.keys(requeued).toSorted()).toEqual(["file", "id", "language", "path", "status"]);
  });
});

describe("useJobStore", () => {
  beforeEach(() => {
    useJobStore.getState().reset();
  });

  it("queues one job per added file", () => {
    useJobStore.getState().addFiles([textFile("a.txt"), textFile("b.txt")]);

    expect(jobsOf().map((job) => job.file.name)).toEqual(["a.txt", "b.txt"]);
    expect(jobsOf().every((job) => job.status === "queued" && progressOf(job) === 0)).toBe(true);
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

    useJobStore.getState().setState(first.id, { progress: 0.5, status: "running" });

    expect(found(first.id)?.status).toBe("running");
    expect(found(second.id)?.status).toBe("queued");
  });

  it("ignores a transition for an id it does not know", () => {
    useJobStore.getState().addFiles([textFile("a.txt")]);

    useJobStore.getState().setState("missing", { result: doneResult, status: "done" });

    expect(jobsOf().map((job) => job.status)).toEqual(["queued"]);
  });

  it("removes a single job", () => {
    const [first, second] = useJobStore.getState().addFiles([textFile("a.txt"), textFile("b.txt")]);

    useJobStore.getState().removeJob(first.id);

    expect(jobsOf().map((job) => job.id)).toEqual([second.id]);
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

    useJobStore.getState().removeJobs([first.id, third.id]);

    expect(jobsOf().map((job) => job.id)).toEqual([second.id]);
  });

  it("ignores ids it does not know when removing in bulk", () => {
    useJobStore.getState().addFiles([textFile("a.txt")]);

    useJobStore.getState().removeJobs(["missing"]);

    expect(jobsOf().length).toBe(1);
  });
});

describe("requeueing", () => {
  beforeEach(() => {
    useJobStore.getState().reset();
  });

  const finish = (id: string) => {
    useJobStore.getState().setState(id, { result: doneResult, status: "done" });
  };

  it("wipes everything the last run left behind", () => {
    const [job] = useJobStore.getState().addFiles([textFile("a.txt")]);

    finish(job.id);
    useJobStore.getState().requeue([job.id], "pt");

    const requeued = jobsOf()[0];

    expect(requeued).toMatchObject({ language: "pt", status: "queued" });
    expect(progressOf(requeued)).toBe(0);
    expect(stageOf(requeued)).toBeUndefined();
    expect("result" in requeued).toBe(false);
  });

  it("returns only the jobs it reset", () => {
    const [first, second] = useJobStore.getState().addFiles([textFile("a.txt"), textFile("b.txt")]);

    finish(first.id);
    finish(second.id);

    const queued = useJobStore.getState().requeue([second.id], "es");

    expect(queued.map((job) => job.id)).toEqual([second.id]);
    expect(found(first.id)?.status).toBe("done");
  });

  it("clears a language back to auto-detect when given none", () => {
    const [job] = useJobStore.getState().addFiles([textFile("a.txt")], "pt");

    useJobStore.getState().requeue([job.id]);

    expect(jobsOf()[0].language).toBeUndefined();
  });

  it("keeps the file and the id so the worker can be sent the same job", () => {
    const [job] = useJobStore.getState().addFiles([textFile("a.txt")]);

    const [queued] = useJobStore.getState().requeue([job.id], "en");

    expect(queued.id).toBe(job.id);
    expect(queued.file).toBe(job.file);
  });
});

describe("job selectors", () => {
  const source: JobSource = { file: textFile("a.txt"), id: "id" };

  const job = (state: JobState, id = "id"): Job => ({ ...source, id, ...state });

  it("reports nothing completed while a job is still queued", () => {
    const jobs = [job({ result: doneResult, status: "done" }, "1"), job({ status: "queued" }, "2")];

    expect(hasCompletedJobs(jobs)).toBe(false);
  });

  it("reports nothing completed while a job is still running", () => {
    const jobs = [
      job({ result: doneResult, status: "done" }, "1"),
      job({ progress: 0.3, status: "running" }, "2"),
    ];

    expect(hasCompletedJobs(jobs)).toBe(false);
  });

  it("reports nothing completed when every job failed", () => {
    expect(hasCompletedJobs([job({ error: "boom", status: "error" })])).toBe(false);
  });

  it("reports nothing completed with no jobs at all", () => {
    expect(hasCompletedJobs([])).toBe(false);
  });

  it("reports completed once every job settled and one succeeded", () => {
    const jobs = [
      job({ result: doneResult, status: "done" }, "1"),
      job({ error: "boom", status: "error" }, "2"),
    ];

    expect(hasCompletedJobs(jobs)).toBe(true);
  });

  it("leaves failed jobs out of the completed set", () => {
    const jobs = [
      job({ result: doneResult, status: "done" }, "1"),
      job({ error: "boom", status: "error" }, "2"),
    ];

    expect(completedJobs(jobs).map((entry) => entry.id)).toEqual(["1"]);
    expect(failedJobs(jobs).map((entry) => entry.id)).toEqual(["2"]);
  });

  it("reads progress and stage off whichever status carries them", () => {
    expect(progressOf(job({ result: doneResult, status: "done" }))).toBe(1);
    expect(progressOf(job({ progress: 0.4, stage: "stage.reading", status: "running" }))).toBe(0.4);
    expect(stageOf(job({ progress: 0.4, stage: "stage.reading", status: "running" }))).toBe(
      "stage.reading",
    );
    expect(stageOf(job({ error: "boom", status: "error" }))).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import type { Job } from "./store";
import { completedJobs, failedJobs, hasCompletedJobs, useJobStore } from "./store";

const textFile = (name: string) => new File(["hello"], name, { type: "text/plain" });

const doneResult = { blob: new Blob(["hello"]), redactionCount: 1, warnings: [] };

const jobsOf = () => useJobStore.getState().jobs;

describe("useJobStore", () => {
  beforeEach(() => {
    useJobStore.getState().reset();
  });

  it("queues one job per added file", () => {
    useJobStore.getState().addFiles([textFile("a.txt"), textFile("b.txt")]);

    expect(jobsOf().map((job) => job.file.name)).toEqual(["a.txt", "b.txt"]);
    expect(jobsOf().every((job) => job.status === "queued" && job.progress === 0)).toBe(true);
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

  it("patches only the job it was given", () => {
    const [first, second] = useJobStore.getState().addFiles([textFile("a.txt"), textFile("b.txt")]);

    useJobStore.getState().updateJob(first.id, { progress: 0.5, status: "running" });

    expect(jobsOf().find((job) => job.id === first.id)?.status).toBe("running");
    expect(jobsOf().find((job) => job.id === second.id)?.status).toBe("queued");
  });

  it("ignores a patch for an id it does not know", () => {
    useJobStore.getState().addFiles([textFile("a.txt")]);

    useJobStore.getState().updateJob("missing", { status: "done" });

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

  const finished = (id: string) => {
    useJobStore.getState().updateJob(id, {
      error: "old failure",
      progress: 1,
      result: doneResult,
      stage: "stage.finished",
      status: "done",
    });
  };

  // A row sent back to the queue carrying its old result would offer a download of the
  // file it is in the middle of replacing.
  it("wipes everything the last run left behind", () => {
    const [job] = useJobStore.getState().addFiles([textFile("a.txt")]);

    finished(job.id);
    useJobStore.getState().requeue([job.id], "pt");

    expect(jobsOf()[0]).toMatchObject({
      error: undefined,
      language: "pt",
      progress: 0,
      result: undefined,
      stage: undefined,
      status: "queued",
    });
  });

  it("returns only the jobs it reset", () => {
    const [first, second] = useJobStore.getState().addFiles([textFile("a.txt"), textFile("b.txt")]);

    finished(first.id);
    finished(second.id);

    const queued = useJobStore.getState().requeue([second.id], "es");

    expect(queued.map((job) => job.id)).toEqual([second.id]);
    expect(jobsOf().find((job) => job.id === first.id)?.status).toBe("done");
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
  const job = (patch: Partial<Job>): Job => ({
    file: textFile("a.txt"),
    id: "id",
    progress: 0,
    status: "queued",
    ...patch,
  });

  it("reports nothing completed while a job is still queued", () => {
    const jobs = [job({ id: "1", result: doneResult, status: "done" }), job({ id: "2" })];

    expect(hasCompletedJobs(jobs)).toBe(false);
  });

  it("reports nothing completed while a job is still running", () => {
    const jobs = [
      job({ id: "1", result: doneResult, status: "done" }),
      job({ id: "2", status: "running" }),
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
      job({ id: "1", result: doneResult, status: "done" }),
      job({ error: "boom", id: "2", status: "error" }),
    ];

    expect(hasCompletedJobs(jobs)).toBe(true);
  });

  it("leaves failed jobs out of the completed set", () => {
    const jobs = [
      job({ id: "1", result: doneResult, status: "done" }),
      job({ error: "boom", id: "2", status: "error" }),
    ];

    expect(completedJobs(jobs).map((entry) => entry.id)).toEqual(["1"]);
    expect(failedJobs(jobs).map((entry) => entry.id)).toEqual(["2"]);
  });

  it("leaves a job claiming success with no result out of the completed set", () => {
    expect(completedJobs([job({ status: "done" })])).toEqual([]);
  });
});

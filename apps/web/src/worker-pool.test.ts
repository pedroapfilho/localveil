/* oxlint-disable anti-slop/no-module-mocking -- workerpool and the model host wrap real Worker threads; the module seam is the only practical hermetic substitute */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRedactionPool } from "./worker-pool";
import {
  job,
  modelHost,
  pooled,
  poolOptions,
  redacted,
  reported,
  resetFixture,
  taskAt,
} from "./worker-pool-fixture";

vi.mock("./redact-worker.ts?worker&url", () => ({ default: "/redact-worker.js" }));
vi.mock("./model-host", async () => {
  const fixture = await import("./worker-pool-fixture");

  return fixture.modelHostDouble;
});
vi.mock("workerpool", async () => {
  const fixture = await import("./worker-pool-fixture");

  return fixture.workerpoolDouble;
});

const build = (maxWorkers = 2) => createRedactionPool(poolOptions(maxWorkers));

const waitOutTheSilence = () => {
  vi.advanceTimersByTime(121_000);
};

beforeEach(resetFixture);

afterEach(resetFixture);

describe("createRedactionPool", () => {
  it("starts every file at once rather than one after another", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.submit(job("b"));
    pool.submit(job("c"));

    expect(pooled.tasks.length).toBe(3);
  });

  it("gives every file its own channel into the model", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.submit(job("b"));

    expect(new Set(pooled.connected).size).toBe(2);
    expect(new Set(pooled.tasks.map((task) => task.options.transfer[0])).size).toBe(2);
  });

  it("passes the file through to the worker", () => {
    const pool = build();
    const file = new File(["x"], "one.txt");

    pool.submit({ file, id: "a" });

    expect(taskAt(0).params[0]).toBe(file);
  });

  it("reports progress against the file it came from", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.submit(job("b"));
    taskAt(1).emit({ fraction: 0.25, stage: "stage.rendering", type: "progress" });

    expect(reported.progress).toEqual([{ fraction: 0.25, id: "b" }]);
  });

  it("ignores anything on the event channel that is not progress", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).emit({ hello: true });

    expect(reported.progress).toEqual([]);
  });

  it("hands back an analysis for the file the task belonged to and hangs up its channel", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).finish({ detections: [], handle: undefined, warnings: [] });

    expect(reported.analysed).toEqual(["a"]);
    expect(pooled.disconnected).toEqual(pooled.connected);
  });

  it("refuses a payload that is not the shape the phase asked for", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).finish(redacted);

    expect(reported.analysed).toEqual([]);
    expect(reported.errors[0]?.message).toMatch(/not an analysis/v);
  });

  it("finishes the file once its decisions are applied, on a channel of its own", () => {
    const pool = build();
    const analysis = { detections: [], handle: undefined, warnings: [] };

    pool.submit(job("a"));
    taskAt(0).finish(analysis);

    pool.apply({
      analysis,
      decisions: { covered: [] },
      file: new File([], "a.txt"),
      id: "a",
    });
    taskAt(1).finish(redacted);

    expect(reported.done).toEqual(["a"]);
    expect(pooled.connected).toHaveLength(2);
    expect(pooled.disconnected).toEqual(pooled.connected);
  });

  it("fails only the file whose worker died", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.submit(job("b"));
    taskAt(0).crash(new Error("Workerpool Worker terminated Unexpectedly"));

    expect(reported.errors).toEqual([
      { id: "a", message: "Workerpool Worker terminated Unexpectedly", unsupported: false },
    ]);
  });

  it("marks a file the registry refused as unsupported", () => {
    const pool = build();
    const refused = new Error("archive.zip is not a supported file type");

    refused.name = "UnsupportedFileError";
    pool.submit(job("a"));
    taskAt(0).crash(refused);

    expect(reported.errors[0].unsupported).toBe(true);
  });

  it("reports a full queue rather than throwing at the caller, and hangs up", () => {
    const pool = build();

    pooled.overflowAfter = 1;
    pool.submit(job("a"));

    expect(() => {
      pool.submit(job("b"));
    }).not.toThrow();
    expect(reported.errors[0]).toMatchObject({ id: "b", unsupported: false });
    expect(pooled.disconnected.length).toBe(1);
  });
});

describe("cancelling a file", () => {
  it("says nothing about a file the reader took away", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.cancel("a");

    expect(taskAt(0).cancelled).toBe(true);
    expect(reported.errors).toEqual([]);
    expect(pooled.disconnected.length).toBe(1);
  });

  it("shrugs off a cancel for a file it never had", () => {
    const pool = build();

    expect(() => {
      pool.cancel("nothing");
    }).not.toThrow();
  });

  it("ignores progress that arrives after the file is gone", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.cancel("a");
    taskAt(0).progress();

    expect(reported.progress).toEqual([]);
  });

  it("ignores a rejection that arrives after the file is gone", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.cancel("a");
    taskAt(0).crash(new Error("promise cancelled"));

    expect(reported.errors).toEqual([]);
  });
});

describe("when a worker goes quiet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves a file still waiting for a worker alone", () => {
    const pool = build(1);

    pool.submit(job("a"));
    waitOutTheSilence();

    expect(reported.errors).toEqual([]);
  });

  it("gives up on a worker that stops mid-file", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();
    waitOutTheSilence();

    expect(reported.errors[0]).toMatchObject({ id: "a" });
    expect(taskAt(0).cancelled).toBe(true);
  });

  it("waits again each time the worker speaks", () => {
    const pool = build();

    pool.submit(job("a"));

    for (let tick = 0; tick < 3; tick += 1) {
      taskAt(0).progress();
      vi.advanceTimersByTime(90_000);
    }

    expect(reported.errors).toEqual([]);
  });

  it("counts the model downloading as a sign of life", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();

    for (let tick = 0; tick < 3; tick += 1) {
      vi.advanceTimersByTime(90_000);
      modelHost().onProgress(0.5, "model.downloading");
    }

    expect(reported.errors).toEqual([]);
  });

  it("reports the failure only once, however late the task settles", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();
    waitOutTheSilence();
    taskAt(0).crash(new Error("promise cancelled"));
    taskAt(0).progress();
    waitOutTheSilence();

    expect(reported.errors.length).toBe(1);
  });

  it("stops watching a file that has finished", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();
    taskAt(0).finish({ detections: [], handle: undefined, warnings: [] });
    waitOutTheSilence();

    expect(reported.errors).toEqual([]);
  });
});

describe("when the model is lost", () => {
  it("fails the files that were mid-flight", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();
    modelHost().onLost("The detection model stopped answering", false);

    expect(reported.errors.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("hands a file that never started back with a new channel", () => {
    const pool = build();

    pool.submit(job("a"));
    modelHost().onLost("The detection model stopped answering", false);

    expect(reported.errors).toEqual([]);
    expect(pooled.tasks.length).toBe(2);
    expect(new Set(pooled.connected).size).toBe(2);
  });

  it("fails everything once the model is beyond recovery", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.submit(job("b"));
    modelHost().onLost("The detection model stopped answering", true);

    expect(reported.errors.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(pooled.tasks.length).toBe(2);
  });

  it("says why, once the model is beyond recovery", () => {
    const pool = build();

    pool.submit(job("a"));
    modelHost().onLost("The detection model stopped answering", true);

    expect(reported.modelLost).toEqual(["The detection model stopped answering"]);
  });

  it("stays quiet about a loss it recovers from", () => {
    const pool = build();

    pool.submit(job("a"));
    modelHost().onLost("The detection model stopped answering", false);

    expect(reported.modelLost).toEqual([]);
  });
});

describe("destroying the pool", () => {
  it("says nothing about the files it kills on the way out", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.submit(job("b"));
    pool.destroy();
    taskAt(0).crash(new Error("Worker terminated"));
    taskAt(1).crash(new Error("Pool terminated"));

    expect(reported.errors).toEqual([]);
    expect(pooled.terminated).toBe(1);
  });

  it("fails a file at once when the model is already gone", () => {
    const pool = build();

    pooled.modelGone = true;
    pool.submit(job("z"));

    expect(reported.errors.map((entry) => entry.id)).toEqual(["z"]);
    expect(pooled.tasks).toHaveLength(0);
  });

  it("does not let a replaced job's watchdog fail the one that took its place", () => {
    vi.useFakeTimers();

    try {
      const pool = build();

      pool.submit(job("a"));
      taskAt(0).emit({ fraction: 0.1, stage: "stage.reading", type: "progress" });
      pool.submit(job("a"));
      waitOutTheSilence();

      expect(reported.errors).toEqual([]);
      expect(taskAt(0).cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

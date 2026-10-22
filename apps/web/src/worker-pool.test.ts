/* oxlint-disable anti-slop/no-module-mocking -- workerpool and the model host wrap real Worker threads; the module seam is the only practical hermetic substitute */
import { describeError } from "@repo/redact-core";
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

const build = () => createRedactionPool(poolOptions());

const failures = () =>
  reported.failed.map(({ cause, id }) => ({ id, message: describeError(cause) }));

const waitOutTheSilence = () => {
  vi.advanceTimersByTime(121_000);
};

beforeEach(resetFixture);

afterEach(resetFixture);

describe("createRedactionPool", () => {
  it("sizes itself to what the device reports", () => {
    build();

    expect(pooled.maxWorkers).toBeGreaterThanOrEqual(1);
  });

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
    expect(failures()[0]?.message).toMatch(/not an analysis/v);
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

    expect(failures()).toEqual([{ id: "a", message: "Workerpool Worker terminated Unexpectedly" }]);
  });

  it("hands over what a refused file threw, for the runner to classify", () => {
    const pool = build();
    const refused = new Error("archive.zip is not a supported file type");

    refused.name = "UnsupportedFileError";
    pool.submit(job("a"));
    taskAt(0).crash(refused);

    expect(reported.failed).toEqual([{ cause: refused, id: "a" }]);
  });

  it("reports a full queue rather than throwing at the caller, and hangs up", () => {
    const pool = build();

    pooled.overflowAfter = 1;
    pool.submit(job("a"));

    expect(() => {
      pool.submit(job("b"));
    }).not.toThrow();
    expect(failures().map((entry) => entry.id)).toEqual(["b"]);
    expect(pooled.disconnected.length).toBe(1);
  });
});

describe("cancelling a file", () => {
  it("says nothing about a file the reader took away", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.cancel("a");

    expect(taskAt(0).cancelled).toBe(true);
    expect(reported.failed).toEqual([]);
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

    expect(reported.failed).toEqual([]);
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
    const pool = build();

    pool.submit(job("a"));
    waitOutTheSilence();

    expect(reported.failed).toEqual([]);
  });

  it("gives up on a worker that stops mid-file", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();
    waitOutTheSilence();

    expect(failures()[0]).toMatchObject({ id: "a" });
    expect(taskAt(0).cancelled).toBe(true);
  });

  it("waits again each time the worker speaks", () => {
    const pool = build();

    pool.submit(job("a"));

    for (let tick = 0; tick < 3; tick += 1) {
      taskAt(0).progress();
      vi.advanceTimersByTime(90_000);
    }

    expect(reported.failed).toEqual([]);
  });

  it("counts each step of the model load as a sign of life", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();

    for (const event of [
      { kind: "loading" },
      { downloaded: 0.5, kind: "loading" },
      { kind: "slow-device" },
    ] as const) {
      vi.advanceTimersByTime(90_000);
      modelHost().onLoad(event);
    }

    expect(reported.failed).toEqual([]);
  });

  it("passes the model load on, failure included", () => {
    build();

    modelHost().onLoad({ kind: "failed", reason: "network down" });

    expect(reported.model).toEqual([{ kind: "failed", reason: "network down" }]);
  });

  it("reports the failure only once, however late the task settles", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();
    waitOutTheSilence();
    taskAt(0).crash(new Error("promise cancelled"));
    taskAt(0).progress();
    waitOutTheSilence();

    expect(reported.failed.length).toBe(1);
  });

  it("stops watching a file that has finished", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();
    taskAt(0).finish({ detections: [], handle: undefined, warnings: [] });
    waitOutTheSilence();

    expect(reported.failed).toEqual([]);
  });
});

describe("when the model is lost", () => {
  it("fails the files that were mid-flight", () => {
    const pool = build();

    pool.submit(job("a"));
    taskAt(0).progress();
    modelHost().onLost("The detection model stopped answering", false);

    expect(failures().map((entry) => entry.id)).toEqual(["a"]);
  });

  it("hands a file that never started back with a new channel", () => {
    const pool = build();

    pool.submit(job("a"));
    modelHost().onLost("The detection model stopped answering", false);

    expect(reported.failed).toEqual([]);
    expect(pooled.tasks.length).toBe(2);
    expect(new Set(pooled.connected).size).toBe(2);
  });

  it("fails everything once the model is beyond recovery", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.submit(job("b"));
    modelHost().onLost("The detection model stopped answering", true);

    expect(failures().map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(pooled.tasks.length).toBe(2);
  });

  it("says why, once the model is beyond recovery", () => {
    const pool = build();

    pool.submit(job("a"));
    modelHost().onLost("The detection model stopped answering", true);

    expect(reported.modelLost).toEqual([
      { failedBefore: 1, fatal: true, reason: "The detection model stopped answering" },
    ]);
  });

  it("reports a loss it recovers from only once every file is failed or restarted", () => {
    const pool = build();

    pool.submit(job("a"));
    pool.submit(job("b"));
    taskAt(0).progress();
    modelHost().onLost("The detection model stopped answering", false);

    expect(reported.modelLost).toEqual([
      { failedBefore: 1, fatal: false, reason: "The detection model stopped answering" },
    ]);
    expect(pooled.tasks).toHaveLength(3);
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

    expect(reported.failed).toEqual([]);
    expect(pooled.terminated).toBe(1);
  });

  it("fails a file at once when the model is already gone", () => {
    const pool = build();

    pooled.modelGone = true;
    pool.submit(job("z"));

    expect(failures().map((entry) => entry.id)).toEqual(["z"]);
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

      expect(reported.failed).toEqual([]);
      expect(taskAt(0).cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("switching the model", () => {
  it("builds its model host for the model it was given", () => {
    build();

    expect(pooled.models).toEqual(["gliner-multi-pii"]);
  });

  it("replaces the model host with one for the new model", () => {
    const pool = build();

    pool.setModel("gliner-pii-base");

    expect(pooled.destroyedHosts).toBe(1);
    expect(pooled.models).toEqual(["gliner-multi-pii", "gliner-pii-base"]);
  });
});

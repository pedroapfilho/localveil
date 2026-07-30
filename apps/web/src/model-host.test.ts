import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createModelHost, MAX_RESPAWNS } from "./model-host";

type Listener = (event: unknown) => void;

// jsdom has no Worker. A test needs to be able to kill this one: the recovery path
// cannot be exercised any other way.
class FakeWorker {
  static instances: Array<FakeWorker> = [];

  posted: Array<unknown> = [];
  terminated = false;

  private readonly handlers = new Map<string, Set<Listener>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: Listener, options?: { signal?: AbortSignal }) {
    const forType = this.handlers.get(type) ?? new Set<Listener>();

    forType.add(handler);
    this.handlers.set(type, forType);

    // The host detaches through an AbortController, so a fake that ignored the signal
    // would keep delivering events from a worker it had already retired.
    options?.signal?.addEventListener("abort", () => {
      forType.delete(handler);
    });
  }

  terminate() {
    this.terminated = true;
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  emit(type: string, event: unknown) {
    // Copied first: a handler that retires the worker detaches itself mid-loop.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const handler of [...(this.handlers.get(type) ?? [])]) {
      handler(event);
    }
  }
}

const lost: Array<{ fatal: boolean; reason: string }> = [];
const progress: Array<string> = [];

const build = () =>
  createModelHost({
    onLost: (reason, fatal) => {
      lost.push({ fatal, reason });
    },
    onProgress: (_fraction, stage) => {
      progress.push(stage);
    },
  });

const workerAt = (index: number) => {
  const worker = FakeWorker.instances[index];

  if (worker === undefined) {
    throw new Error(`No worker was created at index ${String(index)}`);
  }

  return worker;
};

beforeEach(() => {
  FakeWorker.instances = [];
  lost.length = 0;
  progress.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createModelHost", () => {
  it("passes the model's own progress along", () => {
    build();
    workerAt(0).emit("message", {
      data: { fraction: 0.5, stage: "model.downloading", type: "model-progress" },
    });

    expect(progress).toEqual(["model.downloading"]);
  });

  it("hands a port over with the channel it belongs to", () => {
    const host = build();
    const { port1 } = new MessageChannel();

    host.connect("c1", port1);

    expect(workerAt(0).posted).toEqual([{ channel: "c1", port: port1, type: "connect" }]);
  });

  it("can hang up on a channel whose port was never taken up", () => {
    const host = build();

    host.disconnect("c1");

    expect(workerAt(0).posted).toEqual([{ channel: "c1", type: "disconnect" }]);
  });
});

describe("when the model worker dies", () => {
  it("retires it and builds a replacement", () => {
    build();
    workerAt(0).emit("error", {});

    expect(workerAt(0).terminated).toBe(true);
    expect(FakeWorker.instances.length).toBe(2);
    expect(lost).toEqual([{ fatal: false, reason: "The detection model stopped answering" }]);
  });

  it("recovers the same way from a reply it could not read", () => {
    build();
    workerAt(0).emit("messageerror", {});

    expect(FakeWorker.instances.length).toBe(2);
  });

  it("sends later work to the replacement", () => {
    const host = build();

    workerAt(0).emit("error", {});
    host.disconnect("c1");

    expect(workerAt(1).posted.length).toBe(1);
    expect(workerAt(0).posted.length).toBe(0);
  });

  // A second event from a worker already replaced used to run the whole recovery
  // again, taking down the files its healthy successor had been given.
  it("ignores a late event from a worker it already replaced", () => {
    build();
    workerAt(0).emit("error", {});
    workerAt(0).emit("error", {});
    workerAt(0).emit("message", {
      data: { fraction: 0.1, stage: "model.downloading", type: "model-progress" },
    });

    expect(lost.length).toBe(1);
    expect(progress).toEqual([]);
    expect(FakeWorker.instances.length).toBe(2);
  });

  // A worker that throws while its module evaluates fails on every attempt, so an
  // uncapped respawn is an infinite create-and-terminate loop.
  it("gives up rather than respawning forever", () => {
    build();

    for (let attempt = 0; attempt <= MAX_RESPAWNS; attempt += 1) {
      workerAt(attempt).emit("error", {});
    }

    expect(FakeWorker.instances.length).toBe(MAX_RESPAWNS + 1);
    expect(lost.at(-1)?.fatal).toBe(true);
    expect(lost.filter((entry) => entry.fatal).length).toBe(1);
  });
});

describe("destroying the host", () => {
  it("terminates the worker", () => {
    build().destroy();

    expect(workerAt(0).terminated).toBe(true);
  });

  // An error already queued when the page went would otherwise spawn a replacement
  // that nothing holds a reference to, downloading the weights for nobody.
  it("does not respawn from an event that arrives after teardown", () => {
    const host = build();

    host.destroy();
    workerAt(0).emit("error", {});

    expect(FakeWorker.instances.length).toBe(1);
    expect(lost).toEqual([]);
  });
});

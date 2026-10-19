/* oxlint-disable anti-slop/no-unknown-parameters -- the fake Worker mirrors the untyped postMessage wire, so its params are unknown by contract */
import type { ModelLoadEvent } from "@repo/pii-detect/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createModelHost, MAX_RESPAWNS } from "./model-host";

type Listener = (event: unknown) => void;

class FakeWorker {
  static instances: Array<FakeWorker> = [];

  posted: Array<unknown> = [];
  terminated = false;

  private readonly handlers = new Map<string, Set<Listener>>();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: Listener, options?: { signal?: AbortSignal }) {
    const forType = this.handlers.get(type) ?? new Set<Listener>();

    forType.add(handler);
    this.handlers.set(type, forType);

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
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }
}

const lost: Array<{ fatal: boolean; reason: string }> = [];
const loads: Array<ModelLoadEvent> = [];

const build = () =>
  createModelHost({
    model: "gliner-multi-pii",
    onLoad: (event) => {
      loads.push(event);
    },
    onLost: (reason, fatal) => {
      lost.push({ fatal, reason });
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
  loads.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createModelHost", () => {
  it("names the worker after the model it loads", () => {
    build();

    expect(workerAt(0).options).toEqual({ name: "gliner-multi-pii", type: "module" });
  });

  it("passes the model's load along, failure included", () => {
    build();
    workerAt(0).emit("message", {
      data: { event: { downloaded: 0.5, kind: "loading" }, type: "model-load" },
    });
    workerAt(0).emit("message", {
      data: { event: { kind: "failed", reason: "network down" }, type: "model-load" },
    });

    expect(loads).toEqual([
      { downloaded: 0.5, kind: "loading" },
      { kind: "failed", reason: "network down" },
    ]);
  });

  it("hands a port over with the channel it belongs to", () => {
    const host = build();
    const { port1 } = new MessageChannel();

    host.connect("c1", port1);

    expect(workerAt(0).posted).toEqual([{ channel: "c1", port: port1, type: "connect" }]);
  });

  it("names a replacement after the same model", () => {
    build();
    workerAt(0).emit("error", {});

    expect(workerAt(1).options.name).toBe("gliner-multi-pii");
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

  it("ignores a late event from a worker it already replaced", () => {
    build();
    workerAt(0).emit("error", {});
    workerAt(0).emit("error", {});
    workerAt(0).emit("message", {
      data: { event: { downloaded: 0.1, kind: "loading" }, type: "model-load" },
    });

    expect(lost.length).toBe(1);
    expect(loads).toEqual([]);
    expect(FakeWorker.instances.length).toBe(2);
  });

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

  it("does not respawn from an event that arrives after teardown", () => {
    const host = build();

    host.destroy();
    workerAt(0).emit("error", {});

    expect(FakeWorker.instances.length).toBe(1);
    expect(lost).toEqual([]);
  });

  it("refuses to connect once the host has been destroyed", () => {
    const host = build();

    host.destroy();

    expect(host.connect("c", {} as MessagePort)).toBe(false);
    expect(workerAt(0).posted).toEqual([]);
  });

  it("refuses to connect once the model is beyond recovery", () => {
    const host = build();

    for (let attempt = 0; attempt <= MAX_RESPAWNS; attempt += 1) {
      workerAt(attempt).emit("error", {});
    }

    expect(host.connect("c", {} as MessagePort)).toBe(false);
    expect(workerAt(MAX_RESPAWNS).posted).toEqual([]);
  });

  it("still connects while respawns remain", () => {
    const host = build();

    workerAt(0).emit("error", {});

    expect(host.connect("c", {} as MessagePort)).toBe(true);
    expect(workerAt(1).posted).toHaveLength(1);
  });
});

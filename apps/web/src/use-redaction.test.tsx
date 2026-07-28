import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useJobStore } from "./store";
import { renderWithI18n } from "./test-utils";
import { useRedaction } from "./use-redaction";
import type { WorkerRequest } from "./worker-protocol";

type Handler = (event: unknown) => void;

// jsdom has no Worker. This one records what it was sent and lets a test kill it,
// which is the whole point: the recovery path cannot be exercised any other way.
class FakeWorker {
  static instances: Array<FakeWorker> = [];

  posted: Array<WorkerRequest> = [];
  terminated = false;

  private readonly handlers = new Map<string, Set<Handler>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: Handler, options?: { signal?: AbortSignal }) {
    const forType = this.handlers.get(type) ?? new Set<Handler>();

    forType.add(handler);
    this.handlers.set(type, forType);

    // The hook detaches through an AbortController, so a fake that ignored the
    // signal would keep delivering events to a worker it had already retired.
    options?.signal?.addEventListener("abort", () => {
      forType.delete(handler);
    });
  }

  removeEventListener(type: string, handler: Handler) {
    this.handlers.get(type)?.delete(handler);
  }

  postMessage(request: WorkerRequest) {
    this.posted.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type: string, event: unknown) {
    // A handler that retires the worker deletes itself from this set mid-loop. A Set
    // tolerates that: entries removed before they are reached are simply skipped.
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }
}

const Harness = () => {
  const { clear, remove, submit } = useRedaction();

  const handleClick = () => {
    submit([
      new File(["one"], "one.txt", { type: "text/plain" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ]);
  };

  const handleRemoveFirst = () => {
    const first = useJobStore.getState().jobs.at(0);

    if (first !== undefined) {
      remove(first.id);
    }
  };

  return (
    <>
      <button onClick={handleClick} type="button">
        submit
      </button>

      <button onClick={handleRemoveFirst} type="button">
        remove
      </button>

      <button onClick={clear} type="button">
        clear
      </button>
    </>
  );
};

const jobsNow = () => useJobStore.getState().jobs;

const workerAt = (index: number) => {
  const worker = FakeWorker.instances[index];

  if (worker === undefined) {
    throw new Error(`No worker was created at index ${String(index)}`);
  }

  return worker;
};

const filesSentTo = (index: number) =>
  workerAt(index)
    .posted.filter((request) => request.type === "redact")
    .map((request) => request.file.name);

const removeFirst = () => {
  fireEvent.click(screen.getByRole("button", { name: "remove" }));
};

const clearAll = () => {
  fireEvent.click(screen.getByRole("button", { name: "clear" }));
};

const submitTwo = () => {
  renderWithI18n(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "submit" }));
};

// The worker takes one file at a time, so a running job is the one it was busy with.
const startFirstJob = () => {
  act(() => {
    workerAt(0).emit("message", {
      data: { fraction: 0.5, id: jobsNow()[0].id, stage: "stage.detecting", type: "progress" },
    });
  });
};

const waitOutTheSilence = () => {
  act(() => {
    vi.advanceTimersByTime(121_000);
  });
};

const killFirstWorker = (message = "worker died") => {
  act(() => {
    workerAt(0).emit("error", { message });
  });
};

beforeEach(() => {
  FakeWorker.instances = [];
  useJobStore.getState().reset();
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useRedaction", () => {
  it("sends every dropped file to the worker", () => {
    submitTwo();

    expect(filesSentTo(0)).toEqual(["one.txt", "two.txt"]);
  });

  it("builds one worker for the page, not one per file", () => {
    submitTwo();

    expect(FakeWorker.instances.length).toBe(1);
  });
});

describe("when the worker dies", () => {
  it("terminates the one that died", () => {
    submitTwo();
    startFirstJob();
    killFirstWorker();

    expect(workerAt(0).terminated).toBe(true);
  });

  it("fails the file it was working on", () => {
    submitTwo();
    startFirstJob();
    killFirstWorker("out of memory");

    expect(jobsNow()[0]).toMatchObject({ error: "out of memory", status: "error" });
  });

  it("does not hand that file back, which would only crash again", () => {
    submitTwo();
    startFirstJob();
    killFirstWorker();

    expect(filesSentTo(1)).not.toContain("one.txt");
  });

  it("gives the files that never ran to a fresh worker", () => {
    submitTwo();
    startFirstJob();
    killFirstWorker();

    expect(FakeWorker.instances.length).toBe(2);
    expect(filesSentTo(1)).toEqual(["two.txt"]);
  });

  it("leaves the requeued file queued rather than marking it failed", () => {
    submitTwo();
    startFirstJob();
    killFirstWorker();

    expect(jobsNow()[1]).toMatchObject({ status: "queued" });
  });

  it("takes new files after the crash instead of posting into a corpse", () => {
    submitTwo();
    startFirstJob();
    killFirstWorker();

    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    expect(workerAt(1).posted.length).toBe(3);
  });

  it("does not spawn a replacement when nothing was waiting", () => {
    renderWithI18n(<Harness />);
    killFirstWorker();

    expect(FakeWorker.instances.length).toBe(1);
  });

  it("recovers the same way from a reply it could not read", () => {
    submitTwo();
    startFirstJob();

    act(() => {
      workerAt(0).emit("messageerror", {});
    });

    expect(workerAt(0).terminated).toBe(true);
    expect(filesSentTo(1)).toEqual(["two.txt"]);
  });

  it("ignores a late error from a worker that was already replaced", () => {
    submitTwo();
    startFirstJob();
    killFirstWorker();

    const before = FakeWorker.instances.length;

    killFirstWorker();

    expect(FakeWorker.instances.length).toBe(before);
  });
});

// A worker killed for running out of memory raises nothing at all: it just stops
// answering. Only the length of the silence tells it apart from slow work.
describe("when the worker goes quiet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on a worker that says nothing for two minutes", () => {
    submitTwo();
    startFirstJob();
    waitOutTheSilence();

    expect(workerAt(0).terminated).toBe(true);
  });

  it("recovers exactly as it does from a crash", () => {
    submitTwo();
    startFirstJob();
    waitOutTheSilence();

    expect(jobsNow()[0].status).toBe("error");
    expect(filesSentTo(1)).toEqual(["two.txt"]);
  });

  it("waits again each time the worker speaks", () => {
    submitTwo();

    for (let tick = 0; tick < 3; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(90_000);
      });
      startFirstJob();
    }

    expect(workerAt(0).terminated).toBe(false);
  });

  it("stops watching once every file has settled", () => {
    submitTwo();

    act(() => {
      for (const job of jobsNow()) {
        workerAt(0).emit("message", {
          data: {
            blob: new Blob(["x"]),
            id: job.id,
            redactionCount: 0,
            type: "done",
            warnings: [],
          },
        });
      }
    });

    waitOutTheSilence();

    expect(workerAt(0).terminated).toBe(false);
    expect(FakeWorker.instances.length).toBe(1);
  });

  it("does not watch a page where nothing was ever dropped", () => {
    renderWithI18n(<Harness />);
    waitOutTheSilence();

    expect(workerAt(0).terminated).toBe(false);
  });

  it("stops watching a worker whose last file was taken away", () => {
    submitTwo();
    startFirstJob();
    removeFirst();
    removeFirst();
    waitOutTheSilence();

    expect(workerAt(0).terminated).toBe(false);
  });
});

// Taking a row off the page used to tell only the page. The worker carried on with
// the file, and everything behind it waited for work nobody wanted.
describe("removing a file", () => {
  it("tells the worker to stop as well as the page", () => {
    submitTwo();

    const id = jobsNow()[0].id;

    removeFirst();

    expect(workerAt(0).posted.at(-1)).toEqual({ id, type: "cancel" });
  });

  it("takes the row off the page", () => {
    submitTwo();
    removeFirst();

    expect(jobsNow().map((job) => job.file.name)).toEqual(["two.txt"]);
  });

  it("cancels the file that is running, not whichever is first in the list", () => {
    submitTwo();
    startFirstJob();

    const running = jobsNow().find((job) => job.status === "running");

    removeFirst();

    expect(workerAt(0).posted.at(-1)).toEqual({ id: running?.id, type: "cancel" });
  });

  it("leaves the rest of the queue where it was", () => {
    submitTwo();
    removeFirst();

    expect(filesSentTo(0)).toEqual(["one.txt", "two.txt"]);
  });
});

describe("clearing the list", () => {
  it("empties the page", () => {
    submitTwo();
    clearAll();

    expect(jobsNow()).toEqual([]);
  });

  // Emptying the list without telling the worker would leave it grinding through
  // files nobody is waiting for, which is the bug the per-row cancel already fixed.
  it("tells the worker to stop every one of them", () => {
    submitTwo();

    const ids = jobsNow().map((job) => job.id);

    clearAll();

    expect(workerAt(0).posted.filter((request) => request.type === "cancel")).toEqual(
      ids.map((id) => ({ id, type: "cancel" })),
    );
  });

  it("leaves the worker alive for whatever is dropped next", () => {
    submitTwo();
    clearAll();

    expect(workerAt(0).terminated).toBe(false);
    expect(FakeWorker.instances.length).toBe(1);
  });

  it("shrugs off a clear with nothing to clear", () => {
    renderWithI18n(<Harness />);
    clearAll();

    expect(jobsNow()).toEqual([]);
  });
});

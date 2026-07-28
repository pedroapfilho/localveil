import { describe, expect, it, vi } from "vitest";

import type { JobQueueOptions } from "./job-queue";
import { createJobQueue } from "./job-queue";
import type { RedactRequest } from "./worker-protocol";

// Typed rather than a bare `vi.fn()`, which reports a return value where the queue
// expects none.
const noReport = () => vi.fn<JobQueueOptions["onError"]>();

const job = (id: string): RedactRequest => ({
  file: new File(["hello"], `${id}.txt`, { type: "text/plain" }),
  id,
  type: "redact",
});

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// A job that reports progress a few times, checking for cancellation each time, the
// way a redactor does once per page.
const pages = (count: number, onPage?: (page: number) => void) => {
  const done: Array<string> = [];

  const run = async (request: RedactRequest, stopIfCancelled: () => void) => {
    for (let page = 0; page < count; page += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
      await Promise.resolve();
      stopIfCancelled();
      onPage?.(page);
    }

    done.push(request.id);
  };

  return { done, run };
};

describe("createJobQueue", () => {
  it("runs the files that were dropped, in the order they arrived", async () => {
    const { done, run } = pages(2);
    const queue = createJobQueue({ onError: noReport(), run });

    queue.enqueue(job("first"));
    queue.enqueue(job("second"));

    await vi.waitFor(() => {
      expect(done).toEqual(["first", "second"]);
    });
  });

  it("runs one file at a time rather than starting the next mid-way", async () => {
    let running = 0;
    let overlapped = false;

    const run = async () => {
      running += 1;
      overlapped ||= running > 1;

      await Promise.resolve();

      running -= 1;
    };

    const queue = createJobQueue({ onError: noReport(), run });

    queue.enqueue(job("first"));
    queue.enqueue(job("second"));

    await settle();

    expect(overlapped).toBe(false);
  });

  it("never starts a file that was cancelled while it waited its turn", async () => {
    const { done, run } = pages(2);
    const queue = createJobQueue({ onError: noReport(), run });

    queue.enqueue(job("first"));
    queue.enqueue(job("second"));
    queue.cancel("second");

    await vi.waitFor(() => {
      expect(done).toEqual(["first"]);
    });
  });

  // The point of the whole thing: a hundred-page PDF used to keep rendering after
  // its row was gone, with everything behind it waiting.
  it("stops the running file at its next page", async () => {
    const seen: Array<number> = [];
    const { done, run } = pages(20, (page) => {
      seen.push(page);
    });
    const queue = createJobQueue({ onError: noReport(), run });

    queue.enqueue(job("long"));

    await settle();
    queue.cancel("long");
    await vi.waitFor(() => {
      expect(done).toEqual([]);
    });

    expect(seen.length).toBeLessThan(20);
  });

  it("takes up the next file once the cancelled one has stopped", async () => {
    const { done, run } = pages(20);
    const queue = createJobQueue({ onError: noReport(), run });

    queue.enqueue(job("long"));
    queue.enqueue(job("short"));

    await settle();
    queue.cancel("long");

    await vi.waitFor(() => {
      expect(done).toEqual(["short"]);
    });
  });

  // There is no row left to put the message on, and reporting to a row that is gone
  // is how "Could not redact ." reached the screen.
  it("says nothing about a file it was told to drop", async () => {
    const onError = noReport();
    const { run } = pages(20);
    const queue = createJobQueue({ onError, run });

    queue.enqueue(job("long"));

    await settle();
    queue.cancel("long");
    await settle();

    expect(onError).not.toHaveBeenCalled();
  });

  it("still reports a file that failed on its own", async () => {
    const onError = noReport();
    const queue = createJobQueue({
      onError,
      run: () => Promise.reject(new Error("no parser")),
    });

    queue.enqueue(job("broken"));

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });

    expect(onError.mock.calls.at(0)?.at(1)).toBeInstanceOf(Error);
  });

  it("carries on with the queue after one file fails", async () => {
    const done: Array<string> = [];
    const queue = createJobQueue({
      onError: noReport(),
      run: (request) => {
        if (request.id === "broken") {
          return Promise.reject(new Error("no parser"));
        }

        done.push(request.id);

        return Promise.resolve();
      },
    });

    queue.enqueue(job("broken"));
    queue.enqueue(job("fine"));

    await vi.waitFor(() => {
      expect(done).toEqual(["fine"]);
    });
  });

  it("shrugs off a cancel for a file it has never heard of", async () => {
    const { done, run } = pages(2);
    const queue = createJobQueue({ onError: noReport(), run });

    queue.cancel("nothing");
    queue.enqueue(job("first"));

    await vi.waitFor(() => {
      expect(done).toEqual(["first"]);
    });
  });

  it("does not carry a cancellation over to the file that follows", async () => {
    const { done, run } = pages(20);
    const queue = createJobQueue({ onError: noReport(), run });

    queue.enqueue(job("long"));

    await settle();
    queue.cancel("long");

    queue.enqueue(job("later"));

    await vi.waitFor(() => {
      expect(done).toEqual(["later"]);
    });
  });
});

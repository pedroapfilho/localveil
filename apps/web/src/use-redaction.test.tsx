import { toast } from "@repo/ui/components/sonner";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useJobStore } from "./store";
import { renderWithI18n } from "./test-utils";
import { useRedaction } from "./use-redaction";
import type { RedactionPoolOptions } from "./worker-pool";

const cancelled: Array<string> = [];
const submitted: Array<{ file: File; id: string; language?: string }> = [];

let destroyed = 0;
let pools = 0;
let options: RedactionPoolOptions | undefined;

// The pool has its own tests. What matters here is that the hook feeds it the right
// files and turns what it reports back into rows on the page.
vi.mock("./worker-pool", () => ({
  createRedactionPool: (given: RedactionPoolOptions) => {
    options = given;
    pools += 1;

    return {
      cancel: (id: string) => {
        cancelled.push(id);
      },
      destroy: () => {
        destroyed += 1;
      },
      submit: (job: { file: File; id: string; language?: string }) => {
        submitted.push(job);
      },
    };
  },
}));

const pool = () => {
  if (options === undefined) {
    throw new Error("The hook never built a pool");
  }

  return options;
};

const Harness = () => {
  const { clear, model, remove, submit } = useRedaction();

  const handleClick = () => {
    submit([
      new File(["one"], "one.txt", { type: "text/plain" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ]);
  };

  const handleClickForced = () => {
    submit([new File(["um"], "um.txt", { type: "text/plain" })], "pt");
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

      <button onClick={handleClickForced} type="button">
        submit-forced
      </button>

      <button onClick={handleRemoveFirst} type="button">
        remove
      </button>

      <button onClick={clear} type="button">
        clear
      </button>

      <output>{model.slowDevice ? "slow" : "fine"}</output>
    </>
  );
};

const jobsNow = () => useJobStore.getState().jobs;

const submitTwo = () => {
  renderWithI18n(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "submit" }));
};

beforeEach(() => {
  cancelled.length = 0;
  submitted.length = 0;
  destroyed = 0;
  pools = 0;
  options = undefined;
  useJobStore.getState().reset();
  vi.spyOn(toast, "error").mockImplementation(() => "");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRedaction", () => {
  it("hands every dropped file to the pool", () => {
    submitTwo();

    expect(submitted.map((job) => job.file.name)).toEqual(["one.txt", "two.txt"]);
  });

  it("builds one pool for the page, not one per file", () => {
    submitTwo();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    expect(pools).toBe(1);
  });

  it("sizes the pool from what the device reports", () => {
    submitTwo();

    expect(pool().maxWorkers).toBeGreaterThanOrEqual(1);
  });

  // On a first visit the weights are still downloading, and a row that says nothing
  // for a minute reads as a row that is stuck.
  it("says the model is loading before the worker says anything", () => {
    submitTwo();

    expect(jobsNow()[0].stage).toBe("stage.loadingModel");
  });

  it("tears the pool down when the page goes", () => {
    const { unmount } = renderWithI18n(<Harness />);

    unmount();

    expect(destroyed).toBe(1);
  });
});

describe("what the pool reports", () => {
  it("puts progress on the row it belongs to", () => {
    submitTwo();

    act(() => {
      pool().onProgress(jobsNow()[0].id, 0.5, "stage.detecting");
    });

    expect(jobsNow()[0]).toMatchObject({
      progress: 0.5,
      stage: "stage.detecting",
      status: "running",
    });
  });

  it("finishes a row with the file it got back", () => {
    submitTwo();

    const blob = new Blob(["x"]);

    act(() => {
      pool().onDone(jobsNow()[0].id, { blob, redactionCount: 3, warnings: ["warning.noText"] });
    });

    expect(jobsNow()[0]).toMatchObject({
      progress: 1,
      result: { blob, redactionCount: 3, warnings: ["warning.noText"] },
      stage: "stage.finished",
      status: "done",
    });
  });

  it("fails a row and says so", () => {
    submitTwo();

    act(() => {
      pool().onError(jobsNow()[0].id, "out of memory", false);
    });

    expect(jobsNow()[0]).toMatchObject({ error: "out of memory", status: "error" });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("one.txt"));
  });

  it("tells an unsupported file apart from a broken one", () => {
    submitTwo();

    act(() => {
      pool().onError(jobsNow()[0].id, "nope", true);
    });

    const [unsupported] = vi.mocked(toast.error).mock.calls[0];

    act(() => {
      pool().onError(jobsNow()[1].id, "nope", false);
    });

    const [failed] = vi.mocked(toast.error).mock.calls[1];

    expect(unsupported).not.toEqual(failed);
  });

  // The warning outlives the stage it arrived on: a device that fell back to wasm is
  // still slow once the model is ready.
  it("keeps the slow device warning after the model is ready", () => {
    renderWithI18n(<Harness />);

    act(() => {
      pool().onModelProgress(0.2, "model.slowDevice");
    });

    act(() => {
      pool().onModelProgress(1, "model.ready");
    });

    expect(screen.getByText("slow")).toBeInTheDocument();
  });
});

describe("a forced document language", () => {
  it("travels with every file the reader submits", () => {
    renderWithI18n(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "submit-forced" }));

    expect(submitted.map((job) => job.language)).toEqual(["pt"]);
  });

  it("stays absent when the reader left the picker on auto", () => {
    submitTwo();

    expect(submitted.map((job) => job.language)).toEqual([undefined, undefined]);
  });
});

// Taking a row off the page used to tell only the page. The worker carried on with the
// file, and everything behind it waited for work nobody wanted.
describe("removing a file", () => {
  it("tells the pool to stop as well as the page", () => {
    submitTwo();

    const id = jobsNow()[0].id;

    fireEvent.click(screen.getByRole("button", { name: "remove" }));

    expect(cancelled).toEqual([id]);
    expect(jobsNow().map((job) => job.file.name)).toEqual(["two.txt"]);
  });
});

describe("clearing the list", () => {
  it("empties the page and stops every file on it", () => {
    submitTwo();

    const ids = jobsNow().map((job) => job.id);

    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    expect(cancelled).toEqual(ids);
    expect(jobsNow()).toEqual([]);
  });

  it("shrugs off a clear with nothing to clear", () => {
    renderWithI18n(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    expect(jobsNow()).toEqual([]);
  });
});

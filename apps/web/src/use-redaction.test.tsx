import type * as RedactCore from "@repo/redact-core";
import { toast } from "@repo/ui/components/sonner";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { progressOf, stageOf, useJobStore } from "./store";
import { renderWithI18n } from "./test-utils";
import { useRedaction } from "./use-redaction";
import type { RedactionPoolOptions } from "./worker-pool";

const archives = vi.hoisted(() => [] as Array<Array<{ blob: Blob; name: string }>>);

vi.mock("@repo/redact-core", async (importOriginal) => {
  const original = await importOriginal<typeof RedactCore>();

  return {
    ...original,
    buildZip: vi.fn((entries: Array<{ blob: Blob; name: string }>) => {
      archives.push(entries);

      return Promise.resolve(new Blob(["zip"]));
    }),
  };
});

const cancelled: Array<string> = [];
const submitted: Array<{ file: File; id: string; language?: string }> = [];

let destroyed = 0;
let pools = 0;
let options: RedactionPoolOptions | undefined;

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

const idsNow = () => useJobStore.getState().jobs.map((job) => job.id);

const Harness = () => {
  const { clear, downloadZip, remove, removeMany, setLanguage, submit } = useRedaction();

  const handleClick = () => {
    submit([
      new File(["one"], "one.txt", { type: "text/plain" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ]);
  };

  const handleClickScans = () => {
    submit([
      new File(["%PDF"], "card.pdf", { type: "application/pdf" }),
      new File(["png"], "scan.png", { type: "image/png" }),
    ]);
  };

  const handleClickForced = () => {
    submit([new File(["um"], "um.txt", { type: "text/plain" })], "pt");
  };

  const handleClickFolder = () => {
    submit([
      {
        file: new File(["report"], "report.txt", { type: "text/plain" }),
        path: "cases/august/report.txt",
      },
    ]);
  };

  const handleSetPortuguese = () => {
    setLanguage(idsNow(), "pt");
  };

  const handleSetAuto = () => {
    setLanguage(idsNow());
  };

  const handleRemoveAll = () => {
    removeMany(idsNow());
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

      <button onClick={handleClickFolder} type="button">
        submit-folder
      </button>

      <button onClick={handleClickScans} type="button">
        submit-scans
      </button>

      <button onClick={handleSetPortuguese} type="button">
        set-pt
      </button>

      <button onClick={handleSetAuto} type="button">
        set-auto
      </button>

      <button onClick={handleRemoveFirst} type="button">
        remove
      </button>

      <button onClick={handleRemoveAll} type="button">
        remove-all
      </button>

      <button onClick={clear} type="button">
        clear
      </button>

      <button
        onClick={() => {
          void downloadZip();
        }}
        type="button"
      >
        download
      </button>
    </>
  );
};

const jobsNow = () => useJobStore.getState().jobs;

const modelNotice = () => {
  const [given] = vi.mocked(toast.promise).mock.calls[0];

  if (!(given instanceof Promise)) {
    throw new Error("The hook never handed sonner a promise");
  }

  return given;
};

const submitTwo = () => {
  renderWithI18n(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "submit" }));
};

const submitScans = () => {
  renderWithI18n(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "submit-scans" }));
};

const setPortuguese = () => {
  fireEvent.click(screen.getByRole("button", { name: "set-pt" }));
};

beforeEach(() => {
  cancelled.length = 0;
  archives.length = 0;
  submitted.length = 0;
  destroyed = 0;
  pools = 0;
  options = undefined;
  useJobStore.getState().reset();
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");

  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:localveil");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

  vi.spyOn(toast, "promise").mockImplementation(() => ({ unwrap: () => Promise.resolve() }));
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

  it("retains a folder path in the output archive", async () => {
    renderWithI18n(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "submit-folder" }));

    act(() => {
      pool().onDone(jobsNow()[0].id, {
        blob: new Blob(["redacted"]),
        redactionCount: 1,
        warnings: [],
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "download" }));

    await vi.waitFor(() => {
      expect(archives[0]?.[0]?.name).toBe("cases/august/report.txt");
    });
  });

  it("says the model is loading before the worker says anything", () => {
    submitTwo();

    expect(stageOf(jobsNow()[0])).toBe("stage.loadingModel");
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
      result: { blob, redactionCount: 3, warnings: ["warning.noText"] },
      status: "done",
    });
    expect(progressOf(jobsNow()[0])).toBe(1);
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

  it("warns once about a device without GPU acceleration", () => {
    renderWithI18n(<Harness />);

    act(() => {
      pool().onModelProgress(0, "model.slowDevice");
    });

    expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
      "Running without GPU acceleration, this will be slow.",
    );
  });

  it("does not warn twice", () => {
    renderWithI18n(<Harness />);

    act(() => {
      pool().onModelProgress(0, "model.slowDevice");
      pool().onModelProgress(0, "model.slowDevice");
    });

    expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
  });

  it("does not take that warning for a download", () => {
    renderWithI18n(<Harness />);

    act(() => {
      pool().onModelProgress(0, "model.slowDevice");
    });

    expect(vi.mocked(toast.promise)).not.toHaveBeenCalled();
  });
});

describe("the model download", () => {
  it("is announced once, however many times the weights report in", () => {
    renderWithI18n(<Harness />);

    act(() => {
      pool().onModelProgress(0.1, "model.downloading");
      pool().onModelProgress(0.4, "model.downloading");
      pool().onModelProgress(0.9, "model.downloading");
    });

    expect(vi.mocked(toast.promise)).toHaveBeenCalledTimes(1);

    const [, copy] = vi.mocked(toast.promise).mock.calls[0];

    expect(copy?.loading).toBe("Downloading the detection model");
    expect(copy?.success).toBe("Detection model ready");
  });

  it("settles when the model is ready", async () => {
    renderWithI18n(<Harness />);

    act(() => {
      pool().onModelProgress(0.4, "model.downloading");
    });

    const notice = modelNotice();

    act(() => {
      pool().onModelProgress(1, "model.ready");
    });

    await expect(notice).resolves.toBeUndefined();
  });

  it("fails when the model is beyond recovery", async () => {
    renderWithI18n(<Harness />);

    act(() => {
      pool().onModelProgress(0.4, "model.downloading");
    });

    const notice = modelNotice();

    act(() => {
      pool().onModelLost("The detection model stopped answering");
    });

    await expect(notice).rejects.toThrow("The detection model stopped answering");
  });

  it("is announced again when the weights are fetched a second time", () => {
    renderWithI18n(<Harness />);

    act(() => {
      pool().onModelProgress(0.4, "model.downloading");
      pool().onModelProgress(1, "model.ready");
      pool().onModelProgress(0.2, "model.downloading");
    });

    expect(vi.mocked(toast.promise)).toHaveBeenCalledTimes(2);
  });

  it("says nothing for a model that was ready before anyone asked", () => {
    renderWithI18n(<Harness />);

    act(() => {
      pool().onModelProgress(1, "model.ready");
    });

    expect(vi.mocked(toast.promise)).not.toHaveBeenCalled();
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

describe("removing a file", () => {
  it("tells the pool to stop as well as the page", () => {
    submitTwo();

    const id = jobsNow()[0].id;

    fireEvent.click(screen.getByRole("button", { name: "remove" }));

    expect(cancelled).toEqual([id]);
    expect(jobsNow().map((job) => job.file.name)).toEqual(["two.txt"]);
  });
});

describe("changing a document's language", () => {
  it("sends the file back to the pool in the new language", () => {
    submitScans();
    setPortuguese();

    expect(submitted.map((job) => [job.file.name, job.language])).toEqual([
      ["card.pdf", undefined],
      ["scan.png", undefined],
      ["card.pdf", "pt"],
      ["scan.png", "pt"],
    ]);
  });

  it("cancels before it re-submits, never after", () => {
    submitScans();

    const ids = idsNow();

    setPortuguese();

    expect(cancelled).toEqual(ids);
    expect(submitted.slice(2).map((job) => job.id)).toEqual(ids);
  });

  it("sends the row back to the queue with the last run wiped off it", () => {
    submitScans();

    act(() => {
      pool().onDone(idsNow()[0], {
        blob: new Blob(["hi"]),
        redactionCount: 2,
        warnings: [],
      });
    });

    setPortuguese();

    const requeued = jobsNow()[0];

    expect(requeued).toMatchObject({
      language: "pt",
      stage: "stage.loadingModel",
      status: "queued",
    });
    expect(progressOf(requeued)).toBe(0);
    expect("result" in requeued).toBe(false);
  });

  it("records the choice on a text file without redoing the work", () => {
    submitTwo();
    setPortuguese();

    expect(submitted.map((job) => job.file.name)).toEqual(["one.txt", "two.txt"]);
    expect(jobsNow().map((job) => job.language)).toEqual(["pt", "pt"]);
  });

  it("takes a file back to auto-detect", () => {
    submitScans();
    setPortuguese();
    fireEvent.click(screen.getByRole("button", { name: "set-auto" }));

    expect(submitted.at(-1)?.language).toBeUndefined();
    expect(jobsNow()[0].language).toBeUndefined();
  });
});

describe("removing several files at once", () => {
  it("stops each one and drops them all", () => {
    submitTwo();

    const ids = idsNow();

    fireEvent.click(screen.getByRole("button", { name: "remove-all" }));

    expect(cancelled).toEqual(ids);
    expect(jobsNow()).toEqual([]);
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

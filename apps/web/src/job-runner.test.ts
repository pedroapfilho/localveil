import type { Analysis, Detection, RedactionResult } from "@repo/redact-core";
import { UnsupportedFileError } from "@repo/redact-core";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobNotice, JobRunner } from "./job-runner";
import { createJobRunner } from "./job-runner";
import { createMemoryPool } from "./memory-pool";
import { useModelLibrary } from "./model-library";
import type { JobPhase } from "./store";
import { progressOf, useJobStore } from "./store";

const CERTAIN: Detection = {
  confidence: 0.9,
  end: 8,
  id: "a",
  label: "private_person",
  preview: "Ana Lima",
  start: 0,
};

const UNSURE: Detection = { ...CERTAIN, confidence: 0.2, id: "b", preview: "Maybe Name" };

const ANALYSIS: Analysis = { detections: [CERTAIN, UNSURE], handle: undefined, warnings: [] };

const REDACTED: RedactionResult = { blob: new Blob(["x"]), redactionCount: 1, warnings: [] };

const LOST = "The detection model stopped answering";

let memory = createMemoryPool();
let notices: Array<JobNotice> = [];
let runner: JobRunner;

const workers = () => memory.workers();

const jobs = () => useJobStore.getState().jobs;

const jobWith = (id: string) => {
  const job = jobs().find((entry) => entry.id === id);

  assert.isDefined(job, `no job ${id}`);

  return job;
};

const submit = (name = "a.txt") => {
  runner.submit([new File(["x"], name, { type: "text/plain" })]);

  const job = jobs().at(-1);

  assert.isDefined(job);

  return job.id;
};

const analysing = () => {
  const id = submit();

  workers().onProgress(id, 0.2, "stage.reading");

  return id;
};

const reviewing = () => {
  const id = submit();

  workers().onAnalysed(id, ANALYSIS);

  return id;
};

const applying = () => {
  const id = reviewing();

  runner.apply(id, ["a"]);

  return id;
};

const INTO: Record<"analysing" | "applying" | "queued" | "reviewing", () => string> = {
  analysing,
  applying,
  queued: submit,
  reviewing,
};

const workerProgress = () => useModelLibrary.getState().entries["gliner-multi-pii"]?.progress;

beforeEach(() => {
  useJobStore.setState({ jobs: [], modelLoading: false });
  useModelLibrary.setState({ entries: {}, selected: "gliner-multi-pii" });
  vi.spyOn(useModelLibrary.getState(), "refresh").mockResolvedValue();
  memory = createMemoryPool();
  notices = [];
  runner = createJobRunner({
    createPool: memory.create,
    onNotice: (notice) => {
      notices.push(notice);
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a job's lifecycle", () => {
  it("queues each file and hands it to the pool on the chosen model", () => {
    const first = submit("a.txt");
    const second = submit("b.txt");

    expect(jobs().map((job) => job.phase)).toEqual(["queued", "queued"]);
    expect(memory.submitted.map((job) => [job.id, job.file.name])).toEqual([
      [first, "a.txt"],
      [second, "b.txt"],
    ]);
    expect(memory.models).toEqual(["gliner-multi-pii"]);
  });

  it("starts analysing once its worker reports, in the first half of the bar", () => {
    const id = submit();

    workers().onProgress(id, 0.5, "stage.detecting");

    expect(jobWith(id)).toMatchObject({
      phase: "analysing",
      progress: 0.25,
      stage: "stage.detecting",
    });
  });

  it("waits for review with only the certain detections covered", () => {
    const id = reviewing();

    expect(jobWith(id)).toMatchObject({ analysis: ANALYSIS, covered: ["a"], phase: "reviewing" });
    expect(progressOf(jobWith(id))).toBe(0.5);
  });

  it("applies exactly the covered set it is handed", () => {
    const id = reviewing();

    runner.apply(id, ["a", "b"]);

    expect(jobWith(id).phase).toBe("applying");
    expect(memory.applied).toEqual([
      { analysis: ANALYSIS, decisions: { covered: ["a", "b"] }, file: jobWith(id).file, id },
    ]);
  });

  it("applies nothing for a file that is not in review", () => {
    const id = analysing();

    runner.apply(id, ["a"]);

    expect(memory.applied).toEqual([]);
    expect(jobWith(id).phase).toBe("analysing");
  });

  it("finishes with the redacted file", () => {
    const id = applying();

    workers().onDone(id, REDACTED);

    expect(jobWith(id)).toMatchObject({ phase: "done", result: REDACTED });
    expect(progressOf(jobWith(id))).toBe(1);
  });
});

describe("a job's progress", () => {
  it("never runs back, from the first report to the finished file", () => {
    const id = submit();
    const seen: Array<number> = [];
    const record = () => {
      seen.push(progressOf(jobWith(id)));
    };

    for (const fraction of [0, 0.4, 0.3, 1]) {
      workers().onProgress(id, fraction, "stage.rendering");
      record();
    }

    workers().onAnalysed(id, ANALYSIS);
    record();
    runner.apply(id, ["a"]);
    record();

    for (const fraction of [0, 0.45, 0.9, 1]) {
      workers().onProgress(id, fraction, "stage.redacting");
      record();
    }

    workers().onDone(id, REDACTED);
    record();

    expect(seen).toEqual(seen.toSorted((left, right) => left - right));
    expect(seen.at(-1)).toBe(1);
  });

  it("holds at half when applying starts its own count at zero", () => {
    const id = reviewing();

    runner.apply(id, ["a"]);
    workers().onProgress(id, 0, "stage.redacting");

    expect(progressOf(jobWith(id))).toBe(0.5);
  });
});

describe("a failed job", () => {
  it("keeps the reason and names the file", () => {
    const id = analysing();

    workers().onFailed(id, new Error("out of memory"));

    expect(jobWith(id)).toMatchObject({ error: "out of memory", phase: "error" });
    expect(notices).toEqual([{ kind: "file-failed", name: "a.txt" }]);
  });

  it("tells a file the registry refused apart from one that broke", () => {
    const id = submit("archive.zip");

    workers().onFailed(id, new UnsupportedFileError("archive.zip", "application/zip"));

    expect(notices).toEqual([{ kind: "file-unsupported", name: "archive.zip" }]);
  });

  it("names a file from a folder by its path", () => {
    runner.submit([{ file: new File(["x"], "report.txt"), path: "cases/august/report.txt" }]);

    const [job] = jobs();

    assert.isDefined(job);
    workers().onFailed(job.id, new Error("boom"));

    expect(notices).toEqual([{ kind: "file-failed", name: "cases/august/report.txt" }]);
  });

  it("ignores a failure for a file in review", () => {
    const id = reviewing();

    workers().onFailed(id, new Error("late"));

    expect(jobWith(id).phase).toBe("reviewing");
    expect(notices).toEqual([]);
  });
});

describe("cancelling a job", () => {
  it.each(Object.keys(INTO) as Array<keyof typeof INTO>)(
    "stops a %s file, drops it, and ignores whatever its worker says after",
    (phase) => {
      const id = INTO[phase]();

      runner.remove([id]);
      workers().onProgress(id, 0.9, "stage.redacting");
      workers().onAnalysed(id, ANALYSIS);
      workers().onDone(id, REDACTED);
      workers().onFailed(id, new Error("promise cancelled"));

      expect(memory.cancelled).toEqual([id]);
      expect(jobs()).toEqual([]);
      expect(notices).toEqual([]);
    },
  );

  it("stops every file when the list is cleared", () => {
    const ids = [submit(), analysing(), reviewing()];

    runner.clear();

    expect(memory.cancelled).toEqual(ids);
    expect(jobs()).toEqual([]);
  });

  it("tears the pool down with the runner", () => {
    runner.destroy();

    expect(memory.destroyed).toBe(1);
  });
});

describe("switching the model", () => {
  it.each(["queued", "analysing", "applying"] satisfies Array<JobPhase>)(
    "waits while a %s file is still reaching the model",
    (phase) => {
      INTO[phase]();

      runner.selectModel("gliner-pii-base");

      expect(useModelLibrary.getState().selected).toBe("gliner-multi-pii");
      expect(memory.models).toEqual(["gliner-multi-pii"]);
    },
  );

  it("moves the library and the pool once every file is in review or settled", () => {
    const done = applying();

    workers().onDone(done, REDACTED);
    reviewing();
    runner.selectModel("gliner-pii-base");

    expect(useModelLibrary.getState().selected).toBe("gliner-pii-base");
    expect(memory.models).toEqual(["gliner-multi-pii", "gliner-pii-base"]);
  });

  it("drops the download notice of the model it leaves", () => {
    workers().onModelLoad({ downloaded: 0.3, kind: "loading" });
    runner.selectModel("gliner-pii-base");

    expect(notices).toEqual([{ kind: "model-downloading" }, { kind: "model-dropped" }]);
    expect(workerProgress()).toBeUndefined();
    expect(useJobStore.getState().modelLoading).toBe(false);
  });
});

describe("the model load", () => {
  it("is loading from its first step until it is ready", () => {
    workers().onModelLoad({ kind: "loading" });

    expect(useJobStore.getState().modelLoading).toBe(true);

    workers().onModelLoad({ kind: "ready" });

    expect(useJobStore.getState().modelLoading).toBe(false);
    expect(notices).toEqual([]);
  });

  it("announces a download once, however often the weights report in", () => {
    for (const downloaded of [undefined, 0.1, 0.4, 0.9]) {
      workers().onModelLoad({ downloaded, kind: "loading" });
    }

    expect(notices).toEqual([{ kind: "model-downloading" }]);
    expect(workerProgress()).toBe(0.9);
  });

  it("settles an announced download as ready and clears the picker's progress", () => {
    workers().onModelLoad({ downloaded: 0.4, kind: "loading" });
    workers().onModelLoad({ kind: "ready" });

    expect(notices).toEqual([{ kind: "model-downloading" }, { kind: "model-ready" }]);
    expect(workerProgress()).toBeUndefined();
  });

  it("says a load failed, download or not", () => {
    workers().onModelLoad({ kind: "loading" });
    workers().onModelLoad({ kind: "failed", reason: "no wasm" });

    expect(notices).toEqual([{ kind: "model-failed" }]);
    expect(useJobStore.getState().modelLoading).toBe(false);
  });

  it("warns once about a device without GPU acceleration", () => {
    workers().onModelLoad({ kind: "slow-device" });
    workers().onModelLoad({ kind: "slow-device" });

    expect(notices).toEqual([{ kind: "slow-device" }]);
    expect(useJobStore.getState().modelLoading).toBe(false);
  });
});

describe("losing the model", () => {
  it("ends a download whose worker died once no file is left to load it again", () => {
    const id = analysing();

    workers().onModelLoad({ downloaded: 0.4, kind: "loading" });
    workers().onFailed(id, new Error(LOST));
    workers().onModelLost(LOST, false);

    expect(notices).toEqual([
      { kind: "model-downloading" },
      { kind: "file-failed", name: "a.txt" },
      { kind: "model-failed" },
    ]);
    expect(workerProgress()).toBeUndefined();
    expect(useJobStore.getState().modelLoading).toBe(false);
  });

  it("leaves the download to the file that starts over on the respawned model", () => {
    const started = analysing();

    submit("b.txt");
    workers().onModelLoad({ downloaded: 0.4, kind: "loading" });
    workers().onFailed(started, new Error(LOST));
    workers().onModelLost(LOST, false);

    expect(notices.map((notice) => notice.kind)).toEqual(["model-downloading", "file-failed"]);
    expect(useJobStore.getState().modelLoading).toBe(true);
  });

  it("says why once the model is beyond recovery", () => {
    workers().onModelLost(LOST, true);

    expect(notices).toEqual([{ kind: "model-lost", reason: LOST }]);
  });

  it("turns a download into the failure once the model is beyond recovery", () => {
    workers().onModelLoad({ downloaded: 0.4, kind: "loading" });
    workers().onModelLost(LOST, true);

    expect(notices).toEqual([{ kind: "model-downloading" }, { kind: "model-failed" }]);
  });
});

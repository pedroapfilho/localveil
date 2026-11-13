import type { ModelId, ModelLoadEvent } from "@repo/pii-detect/models";
import type { Analysis, Decisions, FileStageKey, RedactionResult } from "@repo/redact";
import { defaultDecisions, isUnsupportedFile, REVIEW_AT } from "@repo/redact";
import { describeError } from "@repo/redact-core";

import { useModelLibrary } from "./model-library";
import type { JobInput, JobState } from "./store";
import { holdsModel, isInFlight, useJobStore } from "./store";

type JobRequest = { file: File; id: string };

type ApplyRequest = { analysis: Analysis; decisions: Decisions; file: File; id: string };

type RedactionPoolOptions = {
  model: ModelId;
  onAnalysed: (id: string, analysis: Analysis) => void;
  onDone: (id: string, result: RedactionResult) => void;
  onFailed: (id: string, cause: unknown) => void;
  onModelLoad: (event: ModelLoadEvent) => void;
  onModelLost: (reason: string, fatal: boolean, restarted: boolean) => void;
  onProgress: (id: string, fraction: number, stage: FileStageKey) => void;
};

type RedactionPool = {
  apply: (request: ApplyRequest) => void;
  cancel: (id: string) => void;
  destroy: () => void;
  setModel: (model: ModelId) => void;
  submit: (job: JobRequest) => void;
};

type CreatePool = (options: RedactionPoolOptions) => RedactionPool;

type JobNotice =
  | { kind: "file-failed" | "file-unsupported"; name: string }
  | { kind: "model-downloading" | "model-dropped" | "model-failed" | "model-ready" | "slow-device" }
  | { kind: "model-lost"; reason: string };

type JobRunnerOptions = {
  createPool: CreatePool;
  onNotice: (notice: JobNotice) => void;
};

type JobRunner = {
  apply: (id: string, covered: ReadonlyArray<string>) => void;
  clear: () => void;
  destroy: () => void;
  remove: (ids: ReadonlyArray<string>) => void;
  selectModel: (model: ModelId) => void;
  submit: (files: Array<JobInput>) => void;
};

const findJob = (id: string) => useJobStore.getState().jobs.find((job) => job.id === id);

const moveJob = (id: string, state: JobState) => {
  useJobStore.getState().setState(id, state);
};

const selected = () => useModelLibrary.getState().selected;

const createJobRunner = ({ createPool, onNotice }: JobRunnerOptions): JobRunner => {
  // Only a load that downloads is announced; a model already kept comes ready without a word.
  let announced = false;
  let warnedSlow = false;

  const endLoad = () => {
    const { refresh, reportWorkerProgress } = useModelLibrary.getState();
    const wasAnnounced = announced;

    announced = false;
    useJobStore.setState({ modelLoading: false });
    reportWorkerProgress(selected(), undefined);
    void refresh(selected());

    return wasAnnounced;
  };

  const loading = (downloaded: number | undefined) => {
    useJobStore.setState({ modelLoading: true });

    if (downloaded === undefined) {
      return;
    }

    useModelLibrary.getState().reportWorkerProgress(selected(), downloaded);

    if (!announced) {
      announced = true;
      onNotice({ kind: "model-downloading" });
    }
  };

  const pool = createPool({
    model: selected(),
    onAnalysed: (id, analysis) => {
      const job = findJob(id);

      if (job?.phase !== "queued" && job?.phase !== "analysing") {
        return;
      }

      moveJob(id, {
        analysis,
        covered: defaultDecisions(analysis.detections).covered,
        phase: "reviewing",
        progress: REVIEW_AT,
      });
    },
    onDone: (id, result) => {
      if (findJob(id)?.phase === "applying") {
        moveJob(id, { phase: "done", result });
      }
    },
    onFailed: (id, cause) => {
      const job = findJob(id);

      if (job === undefined || !isInFlight(job)) {
        return;
      }

      moveJob(id, { error: describeError(cause), phase: "error" });
      onNotice({
        kind: isUnsupportedFile(cause) ? "file-unsupported" : "file-failed",
        name: job.path,
      });
    },
    onModelLoad: (event) => {
      switch (event.kind) {
        case "loading": {
          loading(event.downloaded);
          break;
        }

        case "slow-device": {
          if (!warnedSlow) {
            warnedSlow = true;
            onNotice({ kind: "slow-device" });
          }

          break;
        }

        case "failed": {
          endLoad();
          onNotice({ kind: "model-failed" });
          break;
        }

        case "ready": {
          if (endLoad()) {
            onNotice({ kind: "model-ready" });
          }

          break;
        }

        default: {
          event satisfies never;
        }
      }
    },
    /* A file restarted after a loss is on the respawned model, and its new load reports itself.
       With none restarted, nothing will ever load there, so the load that was under way ends. */
    onModelLost: (reason, fatal, restarted) => {
      if (restarted) {
        return;
      }

      if (endLoad()) {
        onNotice({ kind: "model-failed" });
      } else if (fatal) {
        onNotice({ kind: "model-lost", reason });
      }
    },
    onProgress: (id, fraction, stage) => {
      const job = findJob(id);

      if (job?.phase === "queued" || job?.phase === "analysing") {
        moveJob(id, { phase: "analysing", progress: fraction, stage });
      } else if (job?.phase === "applying") {
        moveJob(id, { phase: "applying", progress: fraction, stage });
      }
    },
  });

  const cancel = (ids: ReadonlyArray<string>) => {
    for (const id of ids) {
      pool.cancel(id);
    }
  };

  return {
    apply: (id, covered) => {
      const job = findJob(id);

      if (job?.phase !== "reviewing") {
        return;
      }

      moveJob(id, { phase: "applying", progress: job.progress });
      pool.apply({ analysis: job.analysis, decisions: { covered }, file: job.file, id });
    },
    clear: () => {
      const { jobs, reset } = useJobStore.getState();

      cancel(jobs.map((job) => job.id));
      reset();
    },
    destroy: () => {
      pool.destroy();
    },
    remove: (ids) => {
      cancel(ids);
      useJobStore.getState().removeJobs(ids);
    },
    selectModel: (next) => {
      if (next === selected() || holdsModel(useJobStore.getState().jobs)) {
        return;
      }

      // A download under way belonged to the old model; its notice would never settle.
      if (endLoad()) {
        onNotice({ kind: "model-dropped" });
      }

      useModelLibrary.getState().select(next);
      pool.setModel(next);
    },
    submit: (files) => {
      for (const job of useJobStore.getState().addFiles(files)) {
        pool.submit({ file: job.file, id: job.id });
      }
    },
  };
};

export { createJobRunner };

export type {
  ApplyRequest,
  CreatePool,
  JobNotice,
  JobRequest,
  JobRunner,
  RedactionPool,
  RedactionPoolOptions,
};

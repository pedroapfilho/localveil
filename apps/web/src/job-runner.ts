import type { ModelId, ModelLoadEvent } from "@repo/pii-detect/models";
import type { Analysis, Decisions, FileStageKey, RedactionResult } from "@repo/redact-core";
import { defaultDecisions, describeError, isUnsupportedFile } from "@repo/redact-core";

import { useModelLibrary } from "./model-library";
import type { JobInput, JobState } from "./store";
import { holdsModel, isInFlight, progressOf, useJobStore } from "./store";

type JobRequest = { file: File; id: string };

type ApplyRequest = { analysis: Analysis; decisions: Decisions; file: File; id: string };

type RedactionPoolOptions = {
  model: ModelId;
  onAnalysed: (id: string, analysis: Analysis) => void;
  onDone: (id: string, result: RedactionResult) => void;
  onFailed: (id: string, cause: unknown) => void;
  onModelLoad: (event: ModelLoadEvent) => void;
  onModelLost: (reason: string, fatal: boolean) => void;
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

// Analysis fills the first half of a file's bar and applying the second, so the bar never runs back.
const SHARES = {
  analysing: { from: 0, to: 0.5 },
  applying: { from: 0.5, to: 1 },
} as const;

const advance = (current: number, phase: keyof typeof SHARES, fraction: number) => {
  const { from, to } = SHARES[phase];

  return Math.max(current, from + (to - from) * Math.min(Math.max(fraction, 0), 1));
};

const findJob = (id: string) => useJobStore.getState().jobs.find((job) => job.id === id);

const moveJob = (id: string, state: JobState) => {
  useJobStore.getState().setState(id, state);
};

const createJobRunner = ({ createPool, onNotice }: JobRunnerOptions): JobRunner => {
  let model = useModelLibrary.getState().selected;

  // Only a load that downloads is announced; a model already kept comes ready without a word.
  let announced = false;
  let warnedSlow = false;

  const endLoad = () => {
    const { refresh, reportWorkerProgress } = useModelLibrary.getState();
    const wasAnnounced = announced;

    announced = false;
    useJobStore.setState({ modelLoading: false });
    reportWorkerProgress(model, undefined);
    void refresh(model);

    return wasAnnounced;
  };

  const loading = (downloaded: number | undefined) => {
    useJobStore.setState({ modelLoading: true });

    if (downloaded === undefined) {
      return;
    }

    useModelLibrary.getState().reportWorkerProgress(model, downloaded);

    if (!announced) {
      announced = true;
      onNotice({ kind: "model-downloading" });
    }
  };

  const pool = createPool({
    model,
    onAnalysed: (id, analysis) => {
      const job = findJob(id);

      if (job?.phase !== "queued" && job?.phase !== "analysing") {
        return;
      }

      moveJob(id, {
        analysis,
        covered: defaultDecisions(analysis.detections).covered,
        phase: "reviewing",
        progress: SHARES.analysing.to,
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
      if (event.kind === "loading") {
        loading(event.downloaded);
      } else if (event.kind === "slow-device") {
        if (!warnedSlow) {
          warnedSlow = true;
          onNotice({ kind: "slow-device" });
        }
      } else if (event.kind === "failed") {
        endLoad();
        onNotice({ kind: "model-failed" });
      } else if (endLoad()) {
        onNotice({ kind: "model-ready" });
      }
    },
    /* A file still in flight after a loss is on the respawned model, and its new load reports
       itself. With none left, nothing will ever load there, so the load that was under way ends. */
    onModelLost: (reason, fatal) => {
      if (!fatal && holdsModel(useJobStore.getState().jobs)) {
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
        moveJob(id, {
          phase: "analysing",
          progress: advance(progressOf(job), "analysing", fraction),
          stage,
        });
      } else if (job?.phase === "applying") {
        moveJob(id, {
          phase: "applying",
          progress: advance(job.progress, "applying", fraction),
          stage,
        });
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
      if (next === model || holdsModel(useJobStore.getState().jobs)) {
        return;
      }

      // A download under way belonged to the old model; its notice would never settle.
      if (endLoad()) {
        onNotice({ kind: "model-dropped" });
      }

      model = next;
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

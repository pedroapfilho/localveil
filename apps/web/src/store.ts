import type { Analysis, FailureKey, FileStageKey, RedactionResult } from "@repo/redact";
import { create } from "zustand";

type JobSource = {
  file: File;
  id: string;
  path: string;
};

type JobState =
  | { analysis: Analysis; covered: ReadonlyArray<string>; phase: "reviewing"; progress: number }
  | { error: string; failure?: FailureKey; phase: "error" }
  | { phase: "analysing"; progress: number; stage: FileStageKey }
  | { phase: "applying"; progress: number; stage?: FileStageKey }
  | { phase: "done"; result: RedactionResult }
  | { phase: "queued" };

type JobPhase = JobState["phase"];

type Job = JobSource & JobState;

type JobStore = {
  addFiles: (files: Array<JobInput>) => Array<Job>;
  jobs: Array<Job>;
  modelLoading: boolean;
  removeJobs: (ids: ReadonlyArray<string>) => void;
  reset: () => void;
  setCovered: (id: string, covered: ReadonlyArray<string>) => void;
  setState: (id: string, state: JobState) => void;
};

type JobInput = Omit<JobSource, "id">;

const justTheSource = ({ file, id, path }: Job): JobSource => ({ file, id, path });

const useJobStore = create<JobStore>((set) => {
  const mapJob = (id: string, change: (job: Job) => Job) => {
    set((state) => ({ jobs: state.jobs.map((job) => (job.id === id ? change(job) : job)) }));
  };

  return {
    addFiles: (files) => {
      const created = files.map(({ file, path }): Job => ({
        file,
        id: crypto.randomUUID(),
        path,
        phase: "queued",
      }));

      set((state) => ({ jobs: [...state.jobs, ...created] }));

      return created;
    },
    jobs: [],
    modelLoading: false,
    removeJobs: (ids) => {
      const dropping = new Set(ids);

      set((state) => ({ jobs: state.jobs.filter((job) => !dropping.has(job.id)) }));
    },
    reset: () => {
      set({ jobs: [] });
    },
    setCovered: (id, covered) => {
      mapJob(id, (job) => (job.phase === "reviewing" ? { ...job, covered } : job));
    },
    setState: (id, next) => {
      mapJob(id, (job) => ({ ...justTheSource(job), ...next }));
    },
  };
});

type CompletedJob = Job & { phase: "done"; result: RedactionResult };

// In flight: still reaching a worker. Working: a worker has it now. Finished: nothing left to do.
const PHASE_TRAITS = {
  analysing: { finished: false, inFlight: true, working: true },
  applying: { finished: false, inFlight: true, working: true },
  done: { finished: true, inFlight: false, working: false },
  error: { finished: true, inFlight: false, working: false },
  queued: { finished: false, inFlight: true, working: false },
  reviewing: { finished: false, inFlight: false, working: false },
} as const satisfies Record<JobPhase, { finished: boolean; inFlight: boolean; working: boolean }>;

const isInFlight = (job: Job) => PHASE_TRAITS[job.phase].inFlight;

const isWorking = (job: Job) => PHASE_TRAITS[job.phase].working;

const isFinished = (job: Job) => PHASE_TRAITS[job.phase].finished;

/* Files already in review keep the analysis their model gave them; only work still reaching the
   model would be split across two of them, so that is what holds a model switch back. */
const holdsModel = (jobs: Array<Job>) => jobs.some((job) => isInFlight(job));

const progressOf = (job: Job) => {
  if (job.phase === "done") {
    return 1;
  }

  return "progress" in job ? job.progress : 0;
};

const stageOf = (job: Job, modelLoading: boolean) => {
  if (job.phase === "queued") {
    return modelLoading ? "stage.loadingModel" : undefined;
  }

  return job.phase === "analysing" || job.phase === "applying" ? job.stage : undefined;
};

const completedJobs = (jobs: Array<Job>): Array<CompletedJob> =>
  jobs.filter((job): job is CompletedJob => job.phase === "done");

const hasCompletedJobs = (jobs: Array<Job>) =>
  jobs.every((job) => isFinished(job)) && completedJobs(jobs).length > 0;

const failedJobs = (jobs: Array<Job>) => jobs.filter((job) => job.phase === "error");

export {
  completedJobs,
  failedJobs,
  hasCompletedJobs,
  holdsModel,
  isInFlight,
  isWorking,
  progressOf,
  stageOf,
  useJobStore,
};

export type { CompletedJob, Job, JobInput, JobPhase, JobSource, JobState };

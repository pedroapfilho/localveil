import type { Analysis, DocumentLanguage, FileStageKey, WarningKey } from "@repo/redact-core";
import { create } from "zustand";

type JobStatus = "done" | "error" | "queued" | "reviewing" | "running";

type JobResult = { blob: Blob; redactionCount: number; warnings: Array<WarningKey> };

type JobSource = {
  file: File;
  id: string;
  language?: DocumentLanguage;
  path?: string;
};

type JobState =
  | { analysis: Analysis; covered: ReadonlyArray<string>; progress: number; status: "reviewing" }
  | { error: string; status: "error" }
  | { progress: number; stage?: FileStageKey; status: "running" }
  | { result: JobResult; status: "done" }
  | { stage?: FileStageKey; status: "queued" };

type Job = JobSource & JobState;

type JobStore = {
  addFiles: (files: Array<JobInput>, language?: DocumentLanguage) => Array<Job>;
  jobs: Array<Job>;
  removeJob: (id: string) => void;
  removeJobs: (ids: ReadonlyArray<string>) => void;
  requeue: (ids: ReadonlyArray<string>, language?: DocumentLanguage) => Array<Job>;
  reset: () => void;
  setCovered: (id: string, covered: ReadonlyArray<string>) => void;
  setLanguage: (id: string, language?: DocumentLanguage) => void;
  setState: (id: string, state: JobState) => void;
};

type JobInput = File | { file: File; path: string };

const sourceOf = (input: JobInput) =>
  input instanceof File
    ? { file: input, path: input.webkitRelativePath || input.name }
    : { file: input.file, path: input.path };

const justTheSource = ({ file, id, language, path }: Job): JobSource => ({
  file,
  id,
  language,
  path,
});

const useJobStore = create<JobStore>((set) => {
  const mapJob = (id: string, change: (job: Job) => Job) => {
    set((state) => ({ jobs: state.jobs.map((job) => (job.id === id ? change(job) : job)) }));
  };

  return {
    addFiles: (files, language) => {
      const created = files.map((input): Job => {
        const { file, path } = sourceOf(input);

        return { file, id: crypto.randomUUID(), language, path, status: "queued" };
      });

      set((state) => ({ jobs: [...state.jobs, ...created] }));

      return created;
    },
    jobs: [],
    removeJob: (id) => {
      set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
    },
    removeJobs: (ids) => {
      const dropping = new Set(ids);

      set((state) => ({ jobs: state.jobs.filter((job) => !dropping.has(job.id)) }));
    },

    requeue: (ids, language) => {
      const requeueing = new Set(ids);
      const queued: Array<Job> = [];

      set((state) => ({
        jobs: state.jobs.map((job) => {
          if (!requeueing.has(job.id)) {
            return job;
          }

          const next: Job = { ...justTheSource(job), language, status: "queued" };

          queued.push(next);

          return next;
        }),
      }));

      return queued;
    },
    reset: () => {
      set({ jobs: [] });
    },
    setCovered: (id, covered) => {
      mapJob(id, (job) => (job.status === "reviewing" ? { ...job, covered } : job));
    },
    setLanguage: (id, language) => {
      mapJob(id, (job) => ({ ...job, language }));
    },
    setState: (id, next) => {
      mapJob(id, (job) => ({ ...justTheSource(job), ...next }));
    },
  };
});

type CompletedJob = Job & { result: JobResult; status: "done" };

const isFinished = (job: Job) => job.status === "done" || job.status === "error";

const isReviewing = (job: Job) => job.status === "reviewing";

const progressOf = (job: Job) => {
  if (job.status === "done") {
    return 1;
  }

  return job.status === "running" || job.status === "reviewing" ? job.progress : 0;
};

const stageOf = (job: Job) =>
  job.status === "queued" || job.status === "running" ? job.stage : undefined;

const completedJobs = (jobs: Array<Job>): Array<CompletedJob> =>
  jobs.filter((job): job is CompletedJob => job.status === "done");

const hasCompletedJobs = (jobs: Array<Job>) =>
  jobs.every((job) => isFinished(job)) && completedJobs(jobs).length > 0;

const failedJobs = (jobs: Array<Job>) => jobs.filter((job) => job.status === "error");

export {
  completedJobs,
  failedJobs,
  hasCompletedJobs,
  isFinished,
  isReviewing,
  progressOf,
  stageOf,
  useJobStore,
};
export type { CompletedJob, Job, JobInput, JobResult, JobSource, JobState, JobStatus };

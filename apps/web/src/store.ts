import type { Analysis, DocumentLanguage, FileStageKey, WarningKey } from "@repo/redact-core";
import { create } from "zustand";

type JobStatus = "done" | "error" | "queued" | "reviewing" | "running";

type JobResult = { blob: Blob; redactionCount: number; warnings: Array<WarningKey> };

type Job = {
  analysis?: Analysis;
  dismissed: ReadonlyArray<string>;
  error?: string;
  file: File;
  id: string;

  language?: DocumentLanguage;
  progress: number;
  result?: JobResult;
  stage?: FileStageKey;
  status: JobStatus;
};

type JobPatch = Partial<Omit<Job, "file" | "id">>;

type JobStore = {
  addFiles: (files: Array<File>, language?: DocumentLanguage) => Array<Job>;
  jobs: Array<Job>;
  removeJob: (id: string) => void;
  removeJobs: (ids: ReadonlyArray<string>) => void;
  requeue: (ids: ReadonlyArray<string>, language?: DocumentLanguage) => Array<Job>;
  reset: () => void;
  updateJob: (id: string, patch: JobPatch) => void;
};

const REQUEUED = {
  analysis: undefined,
  dismissed: [],
  error: undefined,
  progress: 0,
  result: undefined,
  stage: undefined,
  status: "queued",
} as const satisfies JobPatch;

const useJobStore = create<JobStore>((set) => ({
  addFiles: (files, language) => {
    const created = files.map((file) => ({
      dismissed: [] as ReadonlyArray<string>,
      file,
      id: crypto.randomUUID(),
      language,
      progress: 0,
      status: "queued" as const,
    }));

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

        const next = { ...job, ...REQUEUED, language };

        queued.push(next);

        return next;
      }),
    }));

    return queued;
  },
  reset: () => {
    set({ jobs: [] });
  },
  updateJob: (id, patch) => {
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    }));
  },
}));

type CompletedJob = Job & { result: JobResult };

const isFinished = (job: Job) => job.status === "done" || job.status === "error";

const isReviewing = (job: Job) => job.status === "reviewing";

const completedJobs = (jobs: Array<Job>): Array<CompletedJob> =>
  jobs.filter((job): job is CompletedJob => job.status === "done" && job.result !== undefined);

const hasCompletedJobs = (jobs: Array<Job>) =>
  jobs.every((job) => isFinished(job)) && completedJobs(jobs).length > 0;

const failedJobs = (jobs: Array<Job>) => jobs.filter((job) => job.status === "error");

export { completedJobs, failedJobs, hasCompletedJobs, isFinished, isReviewing, useJobStore };
export type { CompletedJob, Job, JobResult, JobStatus };

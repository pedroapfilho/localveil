import type { DocumentLanguage, FileStageKey, WarningKey } from "@repo/redact-core";
import { create } from "zustand";

type JobStatus = "done" | "error" | "queued" | "running";

type JobResult = { blob: Blob; redactionCount: number; warnings: Array<WarningKey> };

type Job = {
  error?: string;
  file: File;
  id: string;
  // Carried on the job rather than the submit call: crash recovery re-sends jobs
  // from here, and a forced OCR language has to survive that.
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

// Everything a previous run left behind. A row sent back to the queue carrying its old
// result would offer a download of the file it is in the middle of replacing.
const REQUEUED = {
  error: undefined,
  progress: 0,
  result: undefined,
  stage: undefined,
  status: "queued",
} as const satisfies JobPatch;

const useJobStore = create<JobStore>((set) => ({
  addFiles: (files, language) => {
    const created = files.map((file) => ({
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
  // Returns the jobs it reset so the caller can post them: it is the only place that
  // knows which rows actually changed, and re-reading the store afterwards would
  // include rows that were already queued for another reason.
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

// Settled, whether or not it produced anything. A file that failed has finished: it is
// not going to move again.
const isFinished = (job: Job) => job.status === "done" || job.status === "error";

const completedJobs = (jobs: Array<Job>): Array<CompletedJob> =>
  jobs.filter((job): job is CompletedJob => job.status === "done" && job.result !== undefined);

// Downloading half an archive is worse than waiting: the ZIP is offered only once
// every file has settled and at least one of them produced something.
const hasCompletedJobs = (jobs: Array<Job>) =>
  jobs.every((job) => isFinished(job)) && completedJobs(jobs).length > 0;

const failedJobs = (jobs: Array<Job>) => jobs.filter((job) => job.status === "error");

export { completedJobs, failedJobs, hasCompletedJobs, isFinished, useJobStore };
export type { CompletedJob, Job, JobResult, JobStatus };

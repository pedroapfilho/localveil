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
  reset: () => void;
  updateJob: (id: string, patch: JobPatch) => void;
};

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

const completedJobs = (jobs: Array<Job>): Array<CompletedJob> =>
  jobs.filter((job): job is CompletedJob => job.status === "done" && job.result !== undefined);

// Downloading half an archive is worse than waiting: the ZIP is offered only once
// every file has settled and at least one of them produced something.
const hasCompletedJobs = (jobs: Array<Job>) =>
  jobs.every((job) => isFinished(job)) && completedJobs(jobs).length > 0;

const failedJobs = (jobs: Array<Job>) => jobs.filter((job) => job.status === "error");

export { completedJobs, failedJobs, hasCompletedJobs, useJobStore };
export type { CompletedJob, Job, JobResult, JobStatus };

import { useTranslations } from "@repo/i18n";
import type { DocumentLanguage } from "@repo/redact-core";
import { buildZip } from "@repo/redact-core";
import { toast } from "@repo/ui/components/sonner";
import { useCallback, useEffect, useRef, useState } from "react";

import { probeCapacity } from "./probe-capacity";
import { completedJobs, useJobStore } from "./store";
import type { JobInput } from "./store";
import { usesLanguage } from "./uses-language";
import type { RedactionPool } from "./worker-pool";
import { createRedactionPool } from "./worker-pool";

const ZIP_NAME = "localveil.zip";

const REVIEW_KEY = "localveil.review";

const readReviewPreference = () => {
  try {
    return globalThis.localStorage.getItem(REVIEW_KEY) !== "off";
  } catch {
    return true;
  }
};

const writeReviewPreference = (on: boolean) => {
  try {
    globalThis.localStorage.setItem(REVIEW_KEY, on ? "on" : "off");
  } catch {
    // oxlint-disable-next-line eslint/no-console
    console.warn("Could not remember the review preference");
  }
};

type Deferred = { promise: Promise<void>; reject: (error: Error) => void; resolve: () => void };

const deferred = (): Deferred => {
  let resolve: Deferred["resolve"] | undefined;
  let reject: Deferred["reject"] | undefined;

  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  if (resolve === undefined || reject === undefined) {
    throw new TypeError("The promise executor did not run");
  }

  return { promise, reject, resolve };
};

const triggerDownload = (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.download = ZIP_NAME;
  link.href = url;
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

const useRedaction = () => {
  const { t } = useTranslations();
  const poolRef = useRef<RedactionPool | null>(null);
  const translateRef = useRef(t);

  const saidSlowRef = useRef(false);
  const [reviewing, setReviewingState] = useState(readReviewPreference);
  const reviewingRef = useRef(reviewing);

  const modelRef = useRef<Deferred | null>(null);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  const ensurePool = useCallback((): RedactionPool => {
    const running = poolRef.current;

    if (running !== null) {
      return running;
    }

    const nameOf = (id: string) => {
      const job = useJobStore.getState().jobs.find((entry) => entry.id === id);

      return job?.path ?? job?.file.name ?? "";
    };

    const pool = createRedactionPool({
      maxWorkers: probeCapacity().maxWorkers,
      onAnalysed: (id, analysis) => {
        const { jobs, updateJob } = useJobStore.getState();
        const job = jobs.find((entry) => entry.id === id);

        if (job === undefined) {
          return;
        }

        if (!reviewingRef.current) {
          poolRef.current?.apply({
            analysis,
            decisions: { dismissed: [], kept: [] },
            file: job.file,
            id,
          });

          return;
        }

        updateJob(id, { analysis, dismissed: [], kept: [], progress: 0.5, status: "reviewing" });
      },
      onDone: (id, result) => {
        useJobStore.getState().updateJob(id, {
          analysis: undefined,
          progress: 1,
          result: {
            blob: result.blob,
            redactionCount: result.redactionCount,
            warnings: result.warnings,
          },
          stage: "stage.finished",
          status: "done",
        });
      },
      onError: (id, message, unsupported) => {
        useJobStore.getState().updateJob(id, { error: message, status: "error" });

        const name = nameOf(id);

        toast.error(
          unsupported
            ? translateRef.current("toast.unsupported", { name })
            : translateRef.current("toast.failed", { name }),
        );
      },

      onModelLost: (reason) => {
        const lost = modelRef.current;

        modelRef.current = null;
        lost?.reject(new Error(reason));
      },

      onModelProgress: (_fraction, stage) => {
        if (stage === "model.slowDevice") {
          if (!saidSlowRef.current) {
            saidSlowRef.current = true;
            toast.warning(translateRef.current("model.slowDevice"));
          }

          return;
        }

        const pending = modelRef.current;

        if (stage === "model.ready") {
          modelRef.current = null;
          pending?.resolve();

          return;
        }

        if (pending !== null) {
          return;
        }

        const started = deferred();

        modelRef.current = started;

        toast.promise(started.promise, {
          error: translateRef.current("model.failed"),
          loading: translateRef.current("model.downloading"),
          success: translateRef.current("model.ready"),
        });
      },
      onProgress: (id, fraction, stage) => {
        useJobStore.getState().updateJob(id, { progress: fraction, stage, status: "running" });
      },
    });

    poolRef.current = pool;

    return pool;
  }, []);

  useEffect(() => {
    ensurePool();

    return () => {
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, [ensurePool]);

  const submit = useCallback(
    (files: Array<JobInput>, language?: DocumentLanguage) => {
      const pool = ensurePool();
      const { addFiles, updateJob } = useJobStore.getState();

      for (const job of addFiles(files, language)) {
        updateJob(job.id, { stage: "stage.loadingModel" });
        pool.submit({ file: job.file, id: job.id, language: job.language });
      }
    },
    [ensurePool],
  );

  const remove = useCallback((id: string) => {
    poolRef.current?.cancel(id);
    useJobStore.getState().removeJob(id);
  }, []);

  const removeMany = useCallback((ids: ReadonlyArray<string>) => {
    const pool = poolRef.current;

    if (pool !== null) {
      for (const id of ids) {
        pool.cancel(id);
      }
    }

    useJobStore.getState().removeJobs(ids);
  }, []);

  const setLanguage = useCallback(
    (ids: ReadonlyArray<string>, language?: DocumentLanguage) => {
      const { jobs, requeue, updateJob } = useJobStore.getState();
      const byId = new Map(jobs.map((job) => [job.id, job]));

      const rerunning = ids.filter((id) => {
        const job = byId.get(id);

        if (job === undefined) {
          return false;
        }

        if (usesLanguage(job.file)) {
          return true;
        }

        updateJob(id, { language });

        return false;
      });

      if (rerunning.length === 0) {
        return;
      }

      const pool = ensurePool();

      for (const id of rerunning) {
        pool.cancel(id);
      }

      for (const job of requeue(rerunning, language)) {
        updateJob(job.id, { stage: "stage.loadingModel" });
        pool.submit({ file: job.file, id: job.id, language: job.language });
      }
    },
    [ensurePool],
  );

  const applyDecisions = useCallback((id: string) => {
    const { jobs, updateJob } = useJobStore.getState();
    const job = jobs.find((entry) => entry.id === id);

    if (job === undefined || job.analysis === undefined) {
      return;
    }

    updateJob(id, { progress: 0.6, status: "running" });
    poolRef.current?.apply({
      analysis: job.analysis,
      decisions: { dismissed: job.dismissed, kept: job.kept },
      file: job.file,
      id,
    });
  }, []);

  const setDismissed = useCallback((id: string, dismissed: ReadonlyArray<string>) => {
    useJobStore.getState().updateJob(id, { dismissed });
  }, []);

  const setKept = useCallback((id: string, kept: ReadonlyArray<string>) => {
    useJobStore.getState().updateJob(id, { kept });
  }, []);

  const setReviewing = useCallback((on: boolean) => {
    reviewingRef.current = on;
    setReviewingState(on);
    writeReviewPreference(on);
  }, []);

  const clear = useCallback(() => {
    const pool = poolRef.current;
    const { jobs, reset } = useJobStore.getState();

    if (pool !== null) {
      for (const job of jobs) {
        pool.cancel(job.id);
      }
    }

    reset();
  }, []);

  const downloadZip = useCallback(async () => {
    const ready = completedJobs(useJobStore.getState().jobs);

    const blob = await buildZip(
      ready.map((job) => ({ blob: job.result.blob, name: job.path ?? job.file.name })),
    );

    triggerDownload(blob);
  }, []);

  return {
    applyDecisions,
    clear,
    downloadZip,
    remove,
    removeMany,
    reviewing,
    setDismissed,
    setKept,
    setLanguage,
    setReviewing,
    submit,
  };
};

export { useRedaction };

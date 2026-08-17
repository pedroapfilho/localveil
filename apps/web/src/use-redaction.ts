import { useTranslations } from "@repo/i18n";
import type { DocumentLanguage } from "@repo/redact-core";
import { buildZip, defaultDecisions } from "@repo/redact-core";
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

// `null` used to mean idle, ready and lost all at once, which is why a model lost after it had
// already loaded rejected nothing and told the user nothing.
type ModelState =
  | { deferred: Deferred; kind: "loading" }
  | { kind: "idle" }
  | { kind: "lost"; reason: string }
  | { kind: "ready" };

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

  const modelRef = useRef<ModelState>({ kind: "idle" });

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
        const { jobs, setState } = useJobStore.getState();
        const job = jobs.find((entry) => entry.id === id);

        if (job === undefined) {
          return;
        }

        if (!reviewingRef.current) {
          poolRef.current?.apply({
            analysis,
            decisions: defaultDecisions(analysis.detections),
            file: job.file,
            id,
          });

          return;
        }

        setState(id, {
          analysis,
          covered: defaultDecisions(analysis.detections).covered,
          progress: 0.5,
          status: "reviewing",
        });
      },
      onDone: (id, result) => {
        useJobStore.getState().setState(id, {
          result: {
            blob: result.blob,
            redactionCount: result.redactionCount,
            warnings: result.warnings,
          },
          status: "done",
        });
      },
      onError: (id, message, unsupported) => {
        useJobStore.getState().setState(id, { error: message, status: "error" });

        const name = nameOf(id);

        toast.error(
          unsupported
            ? translateRef.current("toast.unsupported", { name })
            : translateRef.current("toast.failed", { name }),
        );
      },

      onModelLost: (reason) => {
        const lost = modelRef.current;

        modelRef.current = { kind: "lost", reason };

        if (lost.kind === "loading") {
          lost.deferred.reject(new Error(reason));

          return;
        }

        // The model can be lost after it has already loaded, and there is no toast in flight to
        // carry the message then; without this the only sign is whatever job fails next.
        toast.error(reason);
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
          modelRef.current = { kind: "ready" };

          if (pending.kind === "loading") {
            pending.deferred.resolve();
          }

          return;
        }

        if (pending.kind === "loading") {
          return;
        }

        const started = deferred();

        modelRef.current = { deferred: started, kind: "loading" };

        toast.promise(started.promise, {
          error: translateRef.current("model.failed"),
          loading: translateRef.current("model.downloading"),
          success: translateRef.current("model.ready"),
        });
      },
      onProgress: (id, fraction, stage) => {
        useJobStore.getState().setState(id, { progress: fraction, stage, status: "running" });
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
      const { addFiles, setState } = useJobStore.getState();

      for (const job of addFiles(files, language)) {
        setState(job.id, { stage: "stage.loadingModel", status: "queued" });
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
      const { jobs, requeue, setLanguage: setJobLanguage, setState } = useJobStore.getState();
      const byId = new Map(jobs.map((job) => [job.id, job]));

      const rerunning = ids.filter((id) => {
        const job = byId.get(id);

        if (job === undefined) {
          return false;
        }

        if (usesLanguage(job.file)) {
          return true;
        }

        setJobLanguage(id, language);

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
        setState(job.id, { stage: "stage.loadingModel", status: "queued" });
        pool.submit({ file: job.file, id: job.id, language: job.language });
      }
    },
    [ensurePool],
  );

  const applyDecisions = useCallback((id: string) => {
    const { jobs, setState } = useJobStore.getState();
    const job = jobs.find((entry) => entry.id === id);

    if (job?.status !== "reviewing") {
      return;
    }

    const { analysis, covered } = job;

    setState(id, { progress: 0.6, status: "running" });
    poolRef.current?.apply({ analysis, decisions: { covered }, file: job.file, id });
  }, []);

  const setCovered = useCallback((id: string, covered: ReadonlyArray<string>) => {
    useJobStore.getState().setCovered(id, covered);
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
    setCovered,
    setLanguage,
    setReviewing,
    submit,
  };
};

export { useRedaction };

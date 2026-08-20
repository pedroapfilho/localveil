import { useTranslations } from "@repo/i18n";
import { buildZip, defaultDecisions } from "@repo/redact-core";
import { toast } from "@repo/ui/components/sonner";
import { useCallback, useEffect, useRef } from "react";

import { probeCapacity } from "./probe-capacity";
import { completedJobs, useJobStore } from "./store";
import type { JobInput } from "./store";
import type { RedactionPool } from "./worker-pool";
import { createRedactionPool } from "./worker-pool";

const ZIP_NAME = "localveil.zip";

type Deferred = { promise: Promise<void>; reject: (error: Error) => void; resolve: () => void };

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
    (files: Array<JobInput>) => {
      const pool = ensurePool();
      const { addFiles, setState } = useJobStore.getState();

      for (const job of addFiles(files)) {
        setState(job.id, { stage: "stage.loadingModel", status: "queued" });
        pool.submit({ file: job.file, id: job.id });
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
    setCovered,
    submit,
  };
};

export { useRedaction };

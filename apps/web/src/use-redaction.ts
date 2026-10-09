import { useTranslations } from "@repo/i18n";
import { buildZip, defaultDecisions } from "@repo/redact-core";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { useModelLibrary } from "./model-library";
import { probeCapacity } from "./probe-capacity";
import { completedJobs, useJobStore } from "./store";
import type { JobInput } from "./store";
import type { RedactionPool } from "./worker-pool";
import { createRedactionPool } from "./worker-pool";

const ZIP_NAME = "localveil.zip";

const MODEL_TOAST = "model-load";

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

  // Only a load that downloads is announced; a model already kept comes ready without a word.
  const announcedRef = useRef(false);

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
      model: useModelLibrary.getState().selected,
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

      onModelLoad: (event) => {
        if (event.kind === "slow-device") {
          if (!saidSlowRef.current) {
            saidSlowRef.current = true;
            toast.warning(translateRef.current("model.slowDevice"));
          }

          return;
        }

        const { refresh, reportWorkerProgress, selected } = useModelLibrary.getState();

        if (event.kind === "loading") {
          if (event.downloaded === undefined) {
            return;
          }

          reportWorkerProgress(selected, event.downloaded);

          if (!announcedRef.current) {
            announcedRef.current = true;
            toast.loading(translateRef.current("model.downloading"), { id: MODEL_TOAST });
          }

          return;
        }

        reportWorkerProgress(selected, undefined);
        void refresh(selected);

        if (event.kind === "failed") {
          toast.error(translateRef.current("model.failed"), { id: MODEL_TOAST });
        } else if (announcedRef.current) {
          toast.success(translateRef.current("model.ready"), { id: MODEL_TOAST });
        }

        announcedRef.current = false;
      },

      onModelLost: (reason) => {
        const { refresh, reportWorkerProgress, selected } = useModelLibrary.getState();

        reportWorkerProgress(selected, undefined);
        void refresh(selected);

        if (announcedRef.current) {
          announcedRef.current = false;
          toast.error(translateRef.current("model.failed"), { id: MODEL_TOAST });

          return;
        }

        toast.error(reason);
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

  useEffect(
    () =>
      useModelLibrary.subscribe((state, previous) => {
        if (state.selected === previous.selected) {
          return;
        }

        // A download that was under way belonged to the old model; its toast would never settle.
        if (announcedRef.current) {
          toast.dismiss(MODEL_TOAST);
        }

        announcedRef.current = false;
        previous.reportWorkerProgress(previous.selected, undefined);
        poolRef.current?.setModel(state.selected);
      }),
    [],
  );

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

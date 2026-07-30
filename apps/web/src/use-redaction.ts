import { useTranslations } from "@repo/i18n";
import type { DocumentLanguage, ModelStageKey } from "@repo/redact-core";
import { buildZip } from "@repo/redact-core";
import { toast } from "@repo/ui/components/sonner";
import { useCallback, useEffect, useRef, useState } from "react";

import { probeCapacity } from "./probe-capacity";
import { completedJobs, useJobStore } from "./store";
import type { RedactionPool } from "./worker-pool";
import { createRedactionPool } from "./worker-pool";

const ZIP_NAME = "localveil.zip";

type ModelState = { fraction: number; slowDevice: boolean; stage?: ModelStageKey };

const INITIAL_MODEL: ModelState = { fraction: 0, slowDevice: false };

const triggerDownload = (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.download = ZIP_NAME;
  link.href = url;
  link.click();

  // WebKit aborts a download whose object URL is revoked in the same task, so the
  // click gets a turn of the event loop to itself first.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

const useRedaction = () => {
  const { t } = useTranslations();
  const [model, setModel] = useState<ModelState>(INITIAL_MODEL);
  const poolRef = useRef<RedactionPool | null>(null);
  const translateRef = useRef(t);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  const ensurePool = useCallback((): RedactionPool => {
    const running = poolRef.current;

    if (running !== null) {
      return running;
    }

    const nameOf = (id: string) =>
      useJobStore.getState().jobs.find((job) => job.id === id)?.file.name ?? "";

    const pool = createRedactionPool({
      maxWorkers: probeCapacity().maxWorkers,
      onDone: (id, result) => {
        useJobStore.getState().updateJob(id, {
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
      onModelProgress: (fraction, stage) => {
        setModel((current) => ({
          fraction,
          slowDevice: current.slowDevice || stage === "model.slowDevice",
          stage,
        }));
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
    (files: Array<File>, language?: DocumentLanguage) => {
      const pool = ensurePool();
      const { addFiles, updateJob } = useJobStore.getState();

      for (const job of addFiles(files, language)) {
        // Set before the worker says anything of its own: on a first visit the weights
        // are still downloading, and a row that says nothing reads as a row stuck.
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
      ready.map((job) => ({ blob: job.result.blob, name: job.file.name })),
    );

    triggerDownload(blob);
  }, []);

  return { clear, downloadZip, model, remove, submit };
};

export { useRedaction };
export type { ModelState };

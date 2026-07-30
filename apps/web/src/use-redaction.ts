import { useTranslations } from "@repo/i18n";
import type { DocumentLanguage, ModelStageKey } from "@repo/redact-core";
import { buildZip } from "@repo/redact-core";
import { toast } from "@repo/ui/components/sonner";
import { useCallback, useEffect, useRef, useState } from "react";

import { probeCapacity } from "./probe-capacity";
import { completedJobs, useJobStore } from "./store";
import { usesLanguage } from "./uses-language";
import type { RedactionPool } from "./worker-pool";
import { createRedactionPool } from "./worker-pool";

const ZIP_NAME = "localveil.zip";

type ModelState = { fraction: number; stage?: ModelStageKey };

const INITIAL_MODEL: ModelState = { fraction: 0 };

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

  // The detector raises this twice on the fallback path, and it is the same news both
  // times.
  const saidSlowRef = useRef(false);

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
      // A slow device is a notice about the machine, not a measurement of the download,
      // and it is reported with a fraction of zero. Taking it as progress sent the bar
      // back to empty on the wasm fallback, which is raised after a whole download
      // attempt has already finished. It is said once, in a toast, because the bar it
      // would otherwise sit beside has no words to spare.
      onModelProgress: (fraction, stage) => {
        if (stage === "model.slowDevice") {
          if (!saidSlowRef.current) {
            saidSlowRef.current = true;
            toast.warning(translateRef.current("model.slowDevice"));
          }

          return;
        }

        setModel({ fraction, stage });
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

  const removeMany = useCallback((ids: ReadonlyArray<string>) => {
    const pool = poolRef.current;

    if (pool !== null) {
      for (const id of ids) {
        pool.cancel(id);
      }
    }

    useJobStore.getState().removeJobs(ids);
  }, []);

  // Cancel before re-submitting, never after: the pool keys a running job by its id,
  // and a cancel arriving behind the replacement would take the replacement down with
  // it. The attempt being replaced can still be several stages deep, and the pool tells
  // its answers apart from the new one's by the channel it was given.
  const setLanguage = useCallback(
    (ids: ReadonlyArray<string>, language?: DocumentLanguage) => {
      const { jobs, requeue, updateJob } = useJobStore.getState();
      const byId = new Map(jobs.map((job) => [job.id, job]));

      // A text file's output cannot change with the language, so the choice is recorded
      // and no work is redone.
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

  return { clear, downloadZip, model, remove, removeMany, setLanguage, submit };
};

export { useRedaction };
export type { ModelState };

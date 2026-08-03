import { useTranslations } from "@repo/i18n";
import type { DocumentLanguage } from "@repo/redact-core";
import { buildZip } from "@repo/redact-core";
import { toast } from "@repo/ui/components/sonner";
import { useCallback, useEffect, useRef } from "react";

import { probeCapacity } from "./probe-capacity";
import { completedJobs, useJobStore } from "./store";
import { usesLanguage } from "./uses-language";
import type { RedactionPool } from "./worker-pool";
import { createRedactionPool } from "./worker-pool";

const ZIP_NAME = "localveil.zip";

type Deferred = { promise: Promise<void>; reject: (error: Error) => void; resolve: () => void };

// The weights arrive as a stream of progress messages rather than as a promise, and
// sonner wants a promise to hang a spinner on, so one is made to stand for the download
// and settled by hand when it lands. The executor runs before the constructor returns,
// which is what leaves both handles set here; checked rather than asserted, the way the
// pool checks what workerpool hands it.
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

  // WebKit aborts a download whose object URL is revoked in the same task, so the
  // click gets a turn of the event loop to itself first.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

const useRedaction = () => {
  const { t } = useTranslations();
  const poolRef = useRef<RedactionPool | null>(null);
  const translateRef = useRef(t);

  // The detector raises this twice on the fallback path, and it is the same news both
  // times.
  const saidSlowRef = useRef(false);

  // Null between downloads. Holding the pair is what keeps one download to one toast:
  // the weights report their way up in hundreds of messages, and each of them would
  // otherwise raise a spinner of its own.
  const modelRef = useRef<Deferred | null>(null);

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
      // Raised only for a model past recovering, so the spinner this settles is never
      // one the next respawn was about to make good on.
      onModelLost: (reason) => {
        const lost = modelRef.current;

        modelRef.current = null;
        lost?.reject(new Error(reason));
      },
      // The fraction goes unread: sonner's spinner has no percentage to put it in, and
      // the file rows have their own bars for the work behind this one.
      onModelProgress: (_fraction, stage) => {
        // A slow device is a notice about the machine rather than a step of the
        // download, so it neither opens the download's notice nor settles it.
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

  return { clear, downloadZip, remove, removeMany, setLanguage, submit };
};

export { useRedaction };

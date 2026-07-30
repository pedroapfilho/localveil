import { useTranslations } from "@repo/i18n";
import type { DocumentLanguage, ModelStageKey } from "@repo/redact-core";
import { buildZip } from "@repo/redact-core";
import { toast } from "@repo/ui/components/sonner";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Job } from "./store";
import { completedJobs, useJobStore } from "./store";
import { usesLanguage } from "./uses-language";
import type { CancelRequest, RedactRequest, WorkerResponse } from "./worker-protocol";

const ZIP_NAME = "localveil.zip";

// A worker the browser kills for running out of memory raises no `error` on the page:
// it simply stops answering, so silence is the only signal there is. Progress arrives
// several times per page even on the slow wasm path.
const SILENCE_LIMIT = 120_000;

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

const sendJob = (worker: Worker, job: Job) => {
  const request: RedactRequest = {
    file: job.file,
    id: job.id,
    language: job.language,
    run: job.run,
    type: "redact",
  };

  // Worker#postMessage has no target origin; its second argument is a transfer
  // list, so the window-to-window rule does not apply here.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage(request);
};

const sendCancel = (worker: Worker, id: string) => {
  const request: CancelRequest = { id, type: "cancel" };

  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage(request);
};

const useRedaction = () => {
  const { t } = useTranslations();
  const [model, setModel] = useState<ModelState>(INITIAL_MODEL);
  const workerRef = useRef<Worker | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translateRef = useRef(t);

  const armWatchdogRef = useRef<(() => void) | null>(null);

  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  // Named so the failure handler below can build its own replacement.
  const ensureWorker = useCallback(
    function spawn(): Worker {
      const running = workerRef.current;

      if (running !== null) {
        return running;
      }

      const worker = new Worker(new URL("redact-worker.ts", import.meta.url), { type: "module" });

      const listeners = new AbortController();

      const nameOf = (id: string) =>
        useJobStore.getState().jobs.find((job) => job.id === id)?.file.name ?? "";

      const retire = () => {
        stopWatchdog();
        listeners.abort();
        worker.terminate();

        // Only if it is still the current one: a later worker must not be unhooked by
        // an event arriving late from an earlier one.
        if (workerRef.current === worker) {
          workerRef.current = null;
        }
      };

      // The worker runs one file at a time, so whichever job is running when it dies
      // is the one that killed it. That job stays failed; handing it straight back to
      // a fresh worker is how a crash becomes a crash loop. The files behind it in the
      // queue never got a turn and are innocent, so they go to the replacement.
      const recover = (reason: string) => {
        retire();

        const { jobs, updateJob } = useJobStore.getState();
        const waiting = jobs.filter((job) => job.status === "queued");

        for (const job of jobs.filter((entry) => entry.status === "running")) {
          updateJob(job.id, { error: reason, status: "error" });
        }

        toast.error(translateRef.current("error.unknown"));

        if (waiting.length === 0) {
          return;
        }

        const replacement = spawn();

        for (const job of waiting) {
          sendJob(replacement, job);
        }
      };

      const armWatchdog = () => {
        stopWatchdog();

        const busy = useJobStore
          .getState()
          .jobs.some((job) => job.status === "queued" || job.status === "running");

        if (!busy) {
          return;
        }

        watchdogRef.current = setTimeout(() => {
          recover("The redaction worker stopped answering");
        }, SILENCE_LIMIT);
      };

      const applyMessage = (message: WorkerResponse) => {
        const { jobs, updateJob } = useJobStore.getState();

        // A slow device is a notice about the machine, not a measurement of the
        // download, and it is reported with a fraction of zero. Letting it through as
        // progress sent the bar back to empty on the wasm fallback, which is raised
        // after a whole download attempt has already finished.
        if (message.type === "model-progress" && message.stage === "model.slowDevice") {
          setModel((current) => ({ ...current, slowDevice: true }));

          return;
        }

        if (message.type === "model-progress") {
          setModel((current) => ({
            fraction: message.fraction,
            slowDevice: current.slowDevice,
            stage: message.stage,
          }));

          return;
        }

        // A run told to stop can still be inside a page of OCR, and it answers on the
        // same id as the run replacing it. Taking its "done" would hand the row a
        // result redacted in the language the reader just changed away from, and would
        // settle the queue enough to offer that result as a download.
        const current = jobs.find((job) => job.id === message.id);

        if (current !== undefined && message.run !== current.run) {
          return;
        }

        if (message.type === "progress") {
          updateJob(message.id, {
            progress: message.fraction,
            stage: message.stage,
            status: "running",
          });

          return;
        }

        if (message.type === "done") {
          updateJob(message.id, {
            progress: 1,
            result: {
              blob: message.blob,
              redactionCount: message.redactionCount,
              warnings: message.warnings,
            },
            stage: "stage.finished",
            status: "done",
          });

          return;
        }

        // A worker's message port is shared with whatever else runs inside it, so a
        // stranger's message is not a job failure.
        if (message.type !== "error") {
          return;
        }

        updateJob(message.id, { error: message.message, status: "error" });

        const name = nameOf(message.id);

        toast.error(
          message.unsupported
            ? translateRef.current("toast.unsupported", { name })
            : translateRef.current("toast.failed", { name }),
        );
      };

      // Armed after the store has been updated, not before: a "done" for the last file
      // has to empty the queue first, or the page would sit under a timer waiting on a
      // worker with nothing left to do.
      const handleMessage = (event: MessageEvent<WorkerResponse>) => {
        applyMessage(event.data);
        armWatchdog();
      };

      const handleError = (event: ErrorEvent) => {
        recover(event.message);
      };

      // Raised instead of `error` when a reply cannot be deserialised, which leaves
      // the worker alive but out of touch, so it is retired the same way.
      const handleMessageError = () => {
        recover("The redaction worker sent a reply that could not be read");
      };

      armWatchdogRef.current = armWatchdog;

      const { signal } = listeners;

      worker.addEventListener("error", handleError, { signal });
      worker.addEventListener("message", handleMessage, { signal });
      worker.addEventListener("messageerror", handleMessageError, { signal });
      workerRef.current = worker;

      return worker;
    },
    [stopWatchdog],
  );

  useEffect(() => {
    ensureWorker();

    return () => {
      stopWatchdog();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [ensureWorker, stopWatchdog]);

  const submit = useCallback(
    (files: Array<File>, language?: DocumentLanguage) => {
      const worker = ensureWorker();

      for (const job of useJobStore.getState().addFiles(files, language)) {
        sendJob(worker, job);
      }

      armWatchdogRef.current?.();
    },
    [ensureWorker],
  );

  const remove = useCallback((id: string) => {
    const worker = workerRef.current;

    if (worker !== null) {
      sendCancel(worker, id);
    }

    useJobStore.getState().removeJob(id);

    // Re-read after the removal: dropping the last file that was in flight has to
    // retire the watchdog rather than leave the page under a timer.
    armWatchdogRef.current?.();
  }, []);

  // Cancel before re-posting, never after: the queue tracks one abandoned flag for
  // whichever job is running, and it clears that flag as it picks the next one up, so a
  // cancel arriving behind the replacement would kill the replacement instead.
  //
  // A job cancelled after its last checkpoint still posts its "done", which lands on a
  // row already set back to queued and briefly shows it as finished. The re-run posts
  // its own "done" afterwards, so the row settles correctly.
  const setLanguage = useCallback(
    (ids: ReadonlyArray<string>, language?: DocumentLanguage) => {
      const { jobs, requeue, updateJob } = useJobStore.getState();
      const byId = new Map(jobs.map((job) => [job.id, job]));

      // A text file's output cannot change with the language, so the choice is
      // recorded and no work is redone.
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

      const worker = ensureWorker();

      for (const id of rerunning) {
        sendCancel(worker, id);
      }

      for (const job of requeue(rerunning, language)) {
        sendJob(worker, job);
      }

      armWatchdogRef.current?.();
    },
    [ensureWorker],
  );

  const clear = useCallback(() => {
    const worker = workerRef.current;
    const { jobs, reset } = useJobStore.getState();

    if (worker !== null) {
      for (const job of jobs) {
        sendCancel(worker, job.id);
      }
    }

    reset();
    armWatchdogRef.current?.();
  }, []);

  const downloadZip = useCallback(async () => {
    const ready = completedJobs(useJobStore.getState().jobs);

    const blob = await buildZip(
      ready.map((job) => ({ blob: job.result.blob, name: job.file.name })),
    );

    triggerDownload(blob);
  }, []);

  const removeMany = useCallback((ids: ReadonlyArray<string>) => {
    const worker = workerRef.current;

    if (worker !== null) {
      for (const id of ids) {
        sendCancel(worker, id);
      }
    }

    useJobStore.getState().removeJobs(ids);
    armWatchdogRef.current?.();
  }, []);

  return { clear, downloadZip, model, remove, removeMany, setLanguage, submit };
};

export { useRedaction };
export type { ModelState };

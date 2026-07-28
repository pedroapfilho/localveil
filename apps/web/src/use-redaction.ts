import { useTranslations } from "@repo/i18n";
import type { ModelStageKey } from "@repo/redact-core";
import { buildZip } from "@repo/redact-core";
import { toast } from "@repo/ui/components/sonner";
import { useCallback, useEffect, useRef, useState } from "react";

import { completedJobs, useJobStore } from "./store";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

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
  const workerRef = useRef<Worker | null>(null);
  const translateRef = useRef(t);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    const worker = new Worker(new URL("redact-worker.ts", import.meta.url), { type: "module" });

    const nameOf = (id: string) =>
      useJobStore.getState().jobs.find((job) => job.id === id)?.file.name ?? "";

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const { updateJob } = useJobStore.getState();

      if (message.type === "model-progress") {
        setModel((current) => ({
          fraction: message.fraction,
          slowDevice: current.slowDevice || message.stage === "model.slowDevice",
          stage: message.stage,
        }));

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

      updateJob(message.id, { error: message.message, status: "error" });

      const name = nameOf(message.id);

      toast.error(
        message.unsupported
          ? translateRef.current("toast.unsupported", { name })
          : translateRef.current("toast.failed", { name }),
      );
    };

    // A worker that dies takes every queued job with it, so the failure is shown
    // rather than left as a row that never moves.
    const handleError = (event: ErrorEvent) => {
      const { jobs, updateJob } = useJobStore.getState();

      for (const job of jobs) {
        if (job.status === "queued" || job.status === "running") {
          updateJob(job.id, { error: event.message, status: "error" });
        }
      }

      toast.error(translateRef.current("error.unknown"));
    };

    worker.addEventListener("error", handleError);
    worker.addEventListener("message", handleMessage);
    workerRef.current = worker;

    return () => {
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("message", handleMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const submit = useCallback((files: Array<File>) => {
    const worker = workerRef.current;

    if (worker === null) {
      throw new Error("The redaction worker is not running");
    }

    for (const job of useJobStore.getState().addFiles(files)) {
      const request: WorkerRequest = { file: job.file, id: job.id, type: "redact" };

      // Worker#postMessage has no target origin; its second argument is a transfer
      // list, so the window-to-window rule does not apply here.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage(request);
    }
  }, []);

  const downloadZip = useCallback(async () => {
    const ready = completedJobs(useJobStore.getState().jobs);

    const blob = await buildZip(
      ready.map((job) => ({ blob: job.result.blob, name: job.file.name })),
    );

    triggerDownload(blob);
  }, []);

  return { downloadZip, model, submit };
};

export { useRedaction };
export type { ModelState };

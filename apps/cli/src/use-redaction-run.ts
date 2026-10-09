import type { ModelId, ModelLoadState } from "@repo/pii-detect/models";
import type { FileStageKey } from "@repo/redact-core";
import { describeError } from "@repo/redact-core";
import { useCallback, useRef, useState } from "react";

import type { RunResult } from "./run-redaction";
import { runRedaction } from "./run-redaction";

type RunProgressState = {
  fileIndex: number;
  fraction: number;
  model: ModelLoadState;
  slowDevice: boolean;
  stage: FileStageKey | null;
};

type RedactionRunOptions = {
  jobs?: number;
  model?: ModelId;
  onSettled: () => void;
  outputDirectory: string;
};

const INITIAL: RunProgressState = {
  fileIndex: 0,
  fraction: 0,
  model: { kind: "loading" },
  slowDevice: false,
  stage: null,
};

const useRedactionRun = ({ jobs, model, onSettled, outputDirectory }: RedactionRunOptions) => {
  const [progress, setProgress] = useState(INITIAL);
  const [result, setResult] = useState<RunResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const start = useCallback(
    (files: ReadonlyArray<string>) => {
      const controller = new AbortController();

      controllerRef.current = controller;
      setProgress(INITIAL);

      const execute = async () => {
        try {
          setResult(
            await runRedaction({
              files,
              jobs,
              model,

              onFileProgress: ({ fraction, index, stage }) => {
                setProgress((current) => ({ ...current, fileIndex: index, fraction, stage }));
              },
              onModelLoad: (event) => {
                setProgress((current) =>
                  event.kind === "slow-device"
                    ? { ...current, slowDevice: true }
                    : { ...current, model: event },
                );
              },
              outputDirectory,
              signal: controller.signal,
            }),
          );
        } catch (error) {
          setFailure(describeError(error));
        } finally {
          onSettled();
        }
      };

      void execute();
    },
    [jobs, model, onSettled, outputDirectory],
  );

  return { cancel, failure, progress, result, start };
};

export { useRedactionRun };

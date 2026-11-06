import type { ModelLoadState } from "@repo/pii-detect/models";
import type { FileStageKey } from "@repo/redact-core";
import { describeError } from "@repo/redact-core";
import { useCallback, useRef, useState } from "react";

import type { RunResult, RunSettings } from "./run-redaction";
import { runRedaction } from "./run-redaction";

type RunProgressState = {
  fileIndex: number;
  fraction: number;
  model: ModelLoadState;
  stage: FileStageKey | null;
};

type RedactionRunOptions = {
  onSettled: () => void;
  outputDirectory: string;
  settings: RunSettings;
};

const INITIAL: RunProgressState = {
  fileIndex: 0,
  fraction: 0,
  model: { kind: "loading" },
  stage: null,
};

const useRedactionRun = ({ onSettled, outputDirectory, settings }: RedactionRunOptions) => {
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
              ...settings,
              files,

              onFileProgress: ({ fraction, index, stage }) => {
                setProgress((current) => ({ ...current, fileIndex: index, fraction, stage }));
              },
              onModelLoad: (event) => {
                if (event.kind !== "slow-device") {
                  setProgress((current) => ({ ...current, model: event }));
                }
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
    [onSettled, outputDirectory, settings],
  );

  return { cancel, failure, progress, result, start };
};

export { useRedactionRun };

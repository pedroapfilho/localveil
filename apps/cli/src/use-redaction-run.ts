import type { FileStageKey } from "@repo/redact-core";
import { describeError } from "@repo/redact-core";
import { useCallback, useRef, useState } from "react";

import type { RunResult } from "./run-redaction";
import { runRedaction } from "./run-redaction";

type RunProgressState = {
  fileIndex: number;
  fraction: number;
  modelFraction: number | null;
  stage: FileStageKey | null;
};

type RedactionRunOptions = {
  jobs?: number;
  onSettled: () => void;
  outputDirectory: string;
};

const INITIAL: RunProgressState = { fileIndex: 0, fraction: 0, modelFraction: null, stage: null };

const useRedactionRun = ({ jobs, onSettled, outputDirectory }: RedactionRunOptions) => {
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

              onFileProgress: ({ fraction, index, stage }) => {
                setProgress({ fileIndex: index, fraction, modelFraction: null, stage });
              },
              onModelProgress: (fraction) => {
                setProgress((current) => ({ ...current, modelFraction: fraction }));
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
    [jobs, onSettled, outputDirectory],
  );

  return { cancel, failure, progress, result, start };
};

export { useRedactionRun };

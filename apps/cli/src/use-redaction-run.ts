import { useCallback, useRef, useState } from "react";

import { reasonFrom } from "./errors";
import type { RunResult } from "./run-redaction";
import { runRedaction } from "./run-redaction";

type RunProgressState = {
  fileIndex: number;
  fraction: number;
  modelFraction: number | null;
  stage: string | null;
};

type RedactionRunOptions = {
  onSettled: () => void;
  outputDirectory: string;
};

const INITIAL: RunProgressState = { fileIndex: 0, fraction: 0, modelFraction: null, stage: null };

const useRedactionRun = ({ onSettled, outputDirectory }: RedactionRunOptions) => {
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
              // Dropping the model fraction here is what makes the download show once:
              // the first sign of real work retires the bar rather than leaving it
              // parked at 100% for the rest of the run.
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
          setFailure(reasonFrom(error));
        } finally {
          onSettled();
        }
      };

      void execute();
    },
    [onSettled, outputDirectory],
  );

  return { cancel, failure, progress, result, start };
};

export { useRedactionRun };

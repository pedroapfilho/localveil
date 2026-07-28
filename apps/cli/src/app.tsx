import { basename } from "node:path";

import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";

import { FileBrowser } from "./file-browser";
import { ProgressView } from "./progress-view";
import { SummaryView } from "./summary-view";
import { useRedactionRun } from "./use-redaction-run";

type Props = {
  initialDirectory: string;
  initialSelection?: ReadonlyArray<string>;
  outputDirectory: string;
};

const App = ({ initialDirectory, initialSelection, outputDirectory }: Props) => {
  const { exit } = useApp();
  const [files, setFiles] = useState<ReadonlyArray<string> | null>(null);
  const [stopping, setStopping] = useState(false);

  // Ink holds the process open until the tree unmounts, so the run has to hand the
  // exit back itself once it settles or the summary would sit there with nothing
  // left to do. `exit` is stable, so this does not re-arm the callback every render.
  const { cancel, failure, progress, result, start } = useRedactionRun({
    onSettled: exit,
    outputDirectory,
  });

  useInput((input, key) => {
    if (!key.ctrl || input !== "c") {
      return;
    }

    // The redactor cannot be interrupted part way through a file, so the first Ctrl+C
    // asks the run to stop at the next boundary, which lets it clear away its
    // temporary archive. A second one is taken as "I mean now" and walks away.
    if (files === null || stopping) {
      exit();
      return;
    }

    setStopping(true);
    cancel();
  });

  const handleConfirm = (chosen: Array<string>) => {
    setFiles(chosen);
    start(chosen);
  };

  const handleQuit = () => {
    exit();
  };

  if (files === null) {
    return (
      <FileBrowser
        initialDirectory={initialDirectory}
        initialSelection={initialSelection}
        onCancel={handleQuit}
        onConfirm={handleConfirm}
      />
    );
  }

  if (failure !== null) {
    return (
      <Box flexDirection="column">
        <Text bold>The run stopped before an archive was written.</Text>

        <Text>{failure}</Text>
      </Box>
    );
  }

  if (result !== null) {
    return <SummaryView result={result} />;
  }

  return (
    <ProgressView
      fileIndex={progress.fileIndex}
      fileName={basename(files[progress.fileIndex] ?? "")}
      fraction={progress.fraction}
      modelFraction={progress.modelFraction}
      stage={progress.stage}
      stopping={stopping}
      total={files.length}
    />
  );
};

export { App };

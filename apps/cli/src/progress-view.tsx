import type { FileStageKey } from "@repo/redact-core";
import { Box, Text, useWindowSize } from "ink";

import { describeKey } from "./messages";
import { ProgressBar } from "./progress-bar";
import { truncateEnd } from "./text";

const BAR_MAX = 40;
const BAR_MIN = 10;

type Props = {
  fileIndex: number;
  fileName: string;
  fraction: number;
  modelFraction: number | null;
  stage: FileStageKey | null;
  stopping: boolean;
  total: number;
};

const ProgressView = ({
  fileIndex,
  fileName,
  fraction,
  modelFraction,
  stage,
  stopping,
  total,
}: Props) => {
  const { columns } = useWindowSize();
  const barWidth = Math.max(BAR_MIN, Math.min(BAR_MAX, columns - 12));
  const nameWidth = Math.max(BAR_MIN, columns - 24);

  return (
    <Box flexDirection="column" gap={1}>
      {modelFraction === null ? null : (
        <Box flexDirection="column">
          <Text bold>{describeKey("model.downloading")}</Text>

          <Text dimColor>Downloaded once and then kept.</Text>

          <ProgressBar fraction={modelFraction} width={barWidth} />
        </Box>
      )}

      <Box flexDirection="column">
        <Text bold>{`File ${fileIndex + 1} of ${total}`}</Text>

        <Text>{truncateEnd(fileName, nameWidth)}</Text>

        <Text dimColor>{stage === null ? describeKey("status.queued") : describeKey(stage)}</Text>

        <ProgressBar fraction={fraction} width={barWidth} />
      </Box>

      <Text dimColor>
        {stopping
          ? "Stopping after this file. Press Ctrl+C again to quit now."
          : "Press Ctrl+C to stop. Nothing leaves this machine."}
      </Text>
    </Box>
  );
};

export { ProgressView };

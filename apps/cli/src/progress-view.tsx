import type { ModelLoadState } from "@repo/pii-detect/models";
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
  model: ModelLoadState;
  stage: FileStageKey | null;
  stopping: boolean;
  total: number;
};

const ProgressView = ({ fileIndex, fileName, fraction, model, stage, stopping, total }: Props) => {
  const { columns } = useWindowSize();
  const barWidth = Math.max(BAR_MIN, Math.min(BAR_MAX, columns - 12));
  const nameWidth = Math.max(BAR_MIN, columns - 24);
  const downloaded = model.kind === "loading" ? model.downloaded : undefined;

  return (
    <Box flexDirection="column" gap={1}>
      {downloaded === undefined ? null : (
        <Box flexDirection="column">
          <Text bold>{describeKey("model.downloading")}</Text>

          <Text dimColor>Downloaded once and then kept.</Text>

          <ProgressBar fraction={downloaded} width={barWidth} />
        </Box>
      )}

      <Box flexDirection="column">
        <Text bold>{`File ${fileIndex + 1} of ${total}`}</Text>

        <Text>{truncateEnd(fileName, nameWidth)}</Text>

        <Text dimColor>{stage === null ? describeKey("status.queued") : describeKey(stage)}</Text>

        <ProgressBar fraction={fraction} width={barWidth} />
      </Box>

      <Text dimColor>{describeKey(stopping ? "cli.stopping" : "cli.stopHint")}</Text>
    </Box>
  );
};

export { ProgressView };

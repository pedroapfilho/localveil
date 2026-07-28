import { Box, Text, useWindowSize } from "ink";

import { describeKey } from "./messages";
import type { RunResult } from "./run-redaction";
import { truncateStart } from "./text";

type Props = {
  result: RunResult;
};

const countFiles = (count: number): string => (count === 1 ? "1 file" : `${count} files`);

const countRedactions = (count: number): string =>
  count === 1 ? "1 redaction" : `${count} redactions`;

const SummaryView = ({ result }: Props) => {
  const { cancelled, failures, fileCount, redactionCount, warnings, zipPath } = result;
  const { columns } = useWindowSize();

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {zipPath === null ? (
          <Text bold>
            {cancelled ? "Stopped, so no archive was written." : "No archive was written."}
          </Text>
        ) : (
          <>
            <Text bold>Wrote the archive</Text>

            <Text>{truncateStart(zipPath, Math.max(20, columns - 2))}</Text>
          </>
        )}

        <Text>{`${countFiles(fileCount)}, ${countRedactions(redactionCount)}`}</Text>
      </Box>

      {warnings.length === 0 ? null : (
        <Box flexDirection="column">
          <Text bold>{`Warnings (${warnings.length})`}</Text>

          {warnings.map((entry) => (
            <Box flexDirection="column" key={entry.name} paddingLeft={2}>
              <Text>{entry.name}</Text>

              {entry.keys.map((key) => (
                <Text dimColor key={key}>{`  ${describeKey(key)}`}</Text>
              ))}
            </Box>
          ))}
        </Box>
      )}

      {failures.length === 0 ? null : (
        <Box flexDirection="column">
          <Text bold>{`Could not redact (${failures.length})`}</Text>

          {failures.map((failure) => (
            <Box flexDirection="column" key={failure.name} paddingLeft={2}>
              <Text>{failure.name}</Text>

              <Text dimColor>{`  ${failure.reason}`}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export { SummaryView };

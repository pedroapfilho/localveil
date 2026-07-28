import { Text } from "ink";

const DEFAULT_WIDTH = 24;

type Props = {
  fraction: number;
  width?: number;
};

const clamp = (fraction: number): number => {
  if (!Number.isFinite(fraction)) {
    return 0;
  }

  return Math.min(1, Math.max(0, fraction));
};

// Hashes and dashes rather than block glyphs or colour, so the bar survives a terminal
// with neither. The percentage beside it carries the number regardless.
const ProgressBar = ({ fraction, width = DEFAULT_WIDTH }: Props) => {
  const safe = clamp(fraction);
  const filled = Math.round(safe * width);
  const percent = Math.round(safe * 100);

  return (
    <Text>
      {`[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${String(percent).padStart(3)}%`}
    </Text>
  );
};

export { ProgressBar };

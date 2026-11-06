import { Text } from "ink";

type Props = {
  fraction: number;
  width: number;
};

const clamp = (fraction: number): number => {
  if (!Number.isFinite(fraction)) {
    return 0;
  }

  return Math.min(1, Math.max(0, fraction));
};

const ProgressBar = ({ fraction, width }: Props) => {
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

import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

type ProgressProps = Omit<ComponentProps<"progress">, "children" | "max" | "value"> & {
  label: string;
  value: number;
};

const clampPercent = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(Math.min(1, Math.max(0, value)) * 100);
};

const Progress = ({ className, label, value, ...props }: ProgressProps) => (
  <progress
    aria-label={label}
    className={cn(
      "bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary h-2 w-full overflow-hidden rounded-full",
      className,
    )}
    data-slot="progress"
    max={100}
    value={clampPercent(value)}
    {...props}
  />
);

export { Progress };
